import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveTopicDataDir } from './topic-storage.ts'

// Fixture roots are built with resolve() so they are ABSOLUTE on every
// platform. A literal 'C:\\Users\\...' is relative on POSIX, where dirname
// then operates on cwd + that string and the assertion against the
// implementation fails while the implementation is correct.
const header = { id: 'session-test', cwd: resolve('workspace'), createdAt: 1 } as unknown as SessionHeader
const SESSIONS_ROOT = resolve('sessions-root')
const DATA_ROOT = resolve('data-root')

describe('resolveTopicDataDir', () => {
  it('places verifier files beside the session artifact', () => {
    const artifact = join(SESSIONS_ROOT, 'project', 'session-test', 'session.jsonl.zstd')
    const result = resolveTopicDataDir({ locate: () => ({ path: artifact }) }, header, 'verifier')
    expect(result).toBe(join(dirname(artifact), 'verifier'))
  })

  it('rejects paths that escape the topic directory', () => {
    const locator = { locate: () => ({ path: join(DATA_ROOT, 'session-test', 'session.jsonl') }) }
    // Build the escaping path with join() so it is '../shared' on POSIX and
    // '..\shared' on Windows. A literal '..\shared' is one ordinary segment
    // on POSIX (backslash is not a separator), so it never escapes and the
    // assertion failed there while the implementation was correct.
    expect(() => resolveTopicDataDir(locator, header, join('..', 'shared'))).toThrow(/inside the topic directory/u)
    expect(() => resolveTopicDataDir(locator, header, SESSIONS_ROOT)).toThrow(/relative/u)
  })

  it('fails closed when the backend cannot locate a topic artifact', () => {
    expect(() => resolveTopicDataDir({ locate: () => undefined }, header, 'verifier')).toThrow(/does not expose/u)
    expect(() => resolveTopicDataDir({}, header, 'verifier')).toThrow(/does not expose/u)
  })

  it('falls back to root-based path when locate is missing', () => {
    const result = resolveTopicDataDir({ root: DATA_ROOT }, header, 'verifier')
    expect(result).toBe(join(DATA_ROOT, 'session-test', 'verifier'))
  })
})

