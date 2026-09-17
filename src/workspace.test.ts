import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MAX_WORKSPACE_FILES, probeWorkspaceChanges, renderWorkspaceChanges, type WorkspaceChangeSource, type WorkspaceEvidenceBudget } from './workspace.ts'

/**
 * Host-recorded workspace evidence is attacker-adjacent input (paths and file contents come from
 * whatever the session touched) and a bounded one (it enters a prompt), so these specs assert the
 * two properties that must never drift: every rendered block stays inside its budget, and nothing
 * about an absent or broken host service can fail the acceptance that is already under way.
 */
const SIGNAL = new AbortController().signal
const BUDGET: WorkspaceEvidenceBudget = { maxItemChars: 20000, maxInputChars: 60000 }

function changeEvent(seq: number, turn = 1): unknown {
  return { type: 'workspace/changes', seq, data: { turn } }
}

function entry(name: string, added = 2, deleted = 1, extra: Record<string, unknown> = {}) {
  return { path: name, display: name, added, deleted, ...extra }
}

/** One text comparison in the host's shape: hunk headers, then `+`/`-`/space-prefixed lines. */
function textDiff(lines: readonly string[]) {
  return {
    kind: 'text',
    path: 'p',
    display: 'p',
    before: true,
    after: true,
    hunks: [{ oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, lines }],
    coarse: false,
  }
}

describe('workspaceChanges probing', () => {
  const contextOf = (value: unknown): Context => ({ get: () => value }) as unknown as Context

  it('accepts the host service only when both methods are callable', () => {
    const service = { summary: () => undefined, diff: async () => undefined }
    expect(probeWorkspaceChanges(contextOf(service))).toBe(service)
    expect(probeWorkspaceChanges(contextOf(undefined))).toBeUndefined()
    // A partial service would fail later, mid-acceptance, where degrading is no longer an option.
    expect(probeWorkspaceChanges(contextOf({ summary: () => undefined }))).toBeUndefined()
    expect(probeWorkspaceChanges(contextOf({ diff: async () => undefined }))).toBeUndefined()
    expect(probeWorkspaceChanges(contextOf(null))).toBeUndefined()
    expect(probeWorkspaceChanges(contextOf('workspaceChanges'))).toBeUndefined()
  })

  it('treats a context that refuses the lookup as an absent service', () => {
    const ctx = { get: () => { throw new Error('unknown service') } } as unknown as Context
    expect(probeWorkspaceChanges(ctx)).toBeUndefined()
  })
})

describe('workspace change evidence', () => {
  it('renders nothing until the session has a workspace/changes event', async () => {
    const summary = vi.fn()
    const source = { summary, diff: vi.fn() } as unknown as WorkspaceChangeSource
    expect(await renderWorkspaceChanges([{ type: 'user/message', seq: 0 }], 'session-1', source, BUDGET, SIGNAL)).toBe('')
    expect(await renderWorkspaceChanges([], 'session-1', source, BUDGET, SIGNAL)).toBe('')
    expect(summary).not.toHaveBeenCalled()
  })

  it('reads the newest change event, and degrades when the host no longer serves its summary', async () => {
    const asked: Array<[string, number]> = []
    const source: WorkspaceChangeSource = {
      summary: (sessionId, seq) => {
        asked.push([sessionId, seq])
        return seq === 9 ? { files: [entry('src/a.ts')], total: 1, added: 2, deleted: 1 } : undefined
      },
      diff: async () => textDiff([' const a = 1', '-const b = 2', '+const b = 3']),
    }
    const rendered = await renderWorkspaceChanges([changeEvent(4), changeEvent(9)], 'session-7', source, BUDGET, SIGNAL)
    // The newest event wins: it describes the state the acceptance judge is looking at.
    expect(asked).toEqual([['session-7', 9]])
    expect(rendered).toContain('Host-recorded workspace changes for turn 1')
    expect(rendered).toContain('not reported by the agent')
    expect(rendered).toContain('- src/a.ts (+2/-1)')
    expect(rendered).toContain('@@ -1,3 +1,3 @@')
    expect(rendered).toContain('+const b = 3')
    // A disposed session (and a host that never recorded the summary) means NO evidence, not an error.
    expect(await renderWorkspaceChanges([changeEvent(4)], 'session-7', source, BUDGET, SIGNAL)).toBe('')
  })

  it('lists binary and oversized files without asking the host to compare them', async () => {
    const diff = vi.fn(async (_sessionId: string, _seq: number, index: number) => index === 3 ? textDiff(['+second']) : textDiff(['+first']))
    const source: WorkspaceChangeSource = {
      summary: () => ({
        files: [entry('src/a.ts'), entry('logo.png', 0, 0, { binary: true }), entry('big.bin', 0, 0, { oversized: true }), entry('src/b.ts')],
        total: 4,
        added: 2,
        deleted: 1,
      }),
      diff,
    }
    const rendered = await renderWorkspaceChanges([changeEvent(3)], 'session-1', source, BUDGET, SIGNAL)
    // Two comparisons, not four: the answer for a binary/oversized file is known in advance.
    expect(diff).toHaveBeenCalledTimes(2)
    // The index is the file's index in the summary, never its position among the rendered ones.
    expect(diff.mock.calls.map(call => call[2])).toEqual([0, 3])
    expect(diff.mock.calls.every(call => call[3] === SIGNAL)).toBe(true)
    expect(rendered).toContain('- logo.png (+0/-0) — binary file; contents not compared')
    expect(rendered).toContain('- big.bin (+0/-0) — file too large to capture; contents not compared')
    expect(rendered).toContain('- src/b.ts')
  })

  it('keeps the surviving files when one comparison fails, and reports what was skipped', async () => {
    const warnings: string[] = []
    const source: WorkspaceChangeSource = {
      summary: () => ({ files: [entry('src/a.ts'), entry('src/b.ts')], total: 2, added: 3, deleted: 2 }),
      diff: async (_sessionId, _seq, index) => {
        if (index === 0) throw new Error('snapshot read failed')
        return textDiff(['+second file'])
      },
    }
    const rendered = await renderWorkspaceChanges([changeEvent(2)], 'session-1', source, { ...BUDGET, warn: message => warnings.push(message) }, SIGNAL)
    expect(rendered).toContain('- src/a.ts (+2/-1) — comparison unavailable')
    expect(rendered).toContain('+second file')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/src\/a\.ts: snapshot read failed/u)
  })

  it('treats a missing comparison as absent evidence rather than a failure', async () => {
    const warnings: string[] = []
    // `diff` resolves undefined once the session is disposed; that is a normal answer, not an error.
    const source: WorkspaceChangeSource = { summary: () => ({ files: [entry('src/a.ts')], total: 1 }), diff: async () => undefined }
    const rendered = await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, { ...BUDGET, warn: message => warnings.push(message) }, SIGNAL)
    expect(rendered).toContain('- src/a.ts (+2/-1) — comparison unavailable')
    expect(warnings).toEqual([])
  })

  it('redacts the file contents before they reach the judge prompt', async () => {
    const source: WorkspaceChangeSource = { summary: () => ({ files: [entry('src/config.ts')], total: 1 }), diff: async () => textDiff(['+const apiKey = "api_key=deadbeefdeadbeef"']) }
    const rendered = await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, BUDGET, SIGNAL)
    expect(rendered).toContain('[REDACTED]')
    expect(rendered).not.toContain('deadbeefdeadbeef')
  })

  it('caps the number of rendered files and says how many were left out', async () => {
    const files = Array.from({ length: 12 }, (_unused, index) => entry('src/f' + index + '.ts'))
    const diff = vi.fn(async () => textDiff(['+one line']))
    const source: WorkspaceChangeSource = { summary: () => ({ files, total: 12, added: 12, deleted: 12 }), diff }
    const rendered = await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, BUDGET, SIGNAL)
    expect(diff).toHaveBeenCalledTimes(MAX_WORKSPACE_FILES)
    expect(rendered).toContain('12 file(s) changed')
    expect(rendered).toContain('showing the first ' + MAX_WORKSPACE_FILES)
    expect(rendered).toContain('- src/f7.ts')
    expect(rendered).not.toContain('src/f8.ts')
  })

  it('splits the combined budget across the rendered files instead of feeding the first one', async () => {
    const files = [entry('a.ts'), entry('b.ts'), entry('c.ts')]
    const long = textDiff(Array.from({ length: 50 }, (_unused, index) => '+' + 'x'.repeat(20) + index))
    const source: WorkspaceChangeSource = { summary: () => ({ files, total: 3, added: 5, deleted: 2 }), diff: async () => long }
    const rendered = await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, { maxItemChars: 20000, maxInputChars: 600 }, SIGNAL)
    // The combined cap holds even though one file alone would fill it five times over.
    expect(rendered.length).toBeLessThanOrEqual(600)
    expect(rendered.length).toBeLessThanOrEqual(20000)
    const sections = rendered.split('\n- ').slice(1)
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      // 600 / 3: every file gets a share, and no file takes more than its share.
      expect(section.length).toBeLessThanOrEqual(200)
      expect(section).toContain('more line(s) not shown')
    }
  })

  it('never exceeds the single-item cap, its own truncation notice included', async () => {
    const source: WorkspaceChangeSource = { summary: () => ({ files: [entry('src/a.ts')], total: 1 }), diff: async () => textDiff(['+x']) }
    // A budget smaller than the provenance header: the notice itself has to fit inside it.
    const rendered = await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, { maxItemChars: 60, maxInputChars: 600 }, SIGNAL)
    expect(rendered.length).toBeLessThanOrEqual(60)
    expect(rendered.endsWith(']')).toBe(true)
  })

  it('renders nothing for a summary the host served without any usable file entry', async () => {
    const cases: unknown[] = [
      { total: 1 },
      { files: [] },
      { files: 'not-a-list' },
      { files: [null, 'nope', 42] },
    ]
    for (const summary of cases) {
      const source = { summary: () => summary, diff: vi.fn() } as unknown as WorkspaceChangeSource
      expect(await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, BUDGET, SIGNAL)).toBe('')
    }
  })

  it('refuses a nonsensical budget instead of rendering unbounded text', async () => {
    const source: WorkspaceChangeSource = { summary: () => ({ files: [entry('src/a.ts')], total: 1 }), diff: async () => textDiff(['+x']) }
    for (const maxItemChars of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await renderWorkspaceChanges([changeEvent(1)], 'session-1', source, { maxItemChars, maxInputChars: 600 }, SIGNAL)).toBe('')
    }
  })
})
