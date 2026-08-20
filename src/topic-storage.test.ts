import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveTopicDataDir } from './topic-storage.ts'

const header = { id: 'session-test', cwd: 'C:\\workspace', createdAt: 1 } as unknown as SessionHeader

describe('resolveTopicDataDir', () => {
  it('places verifier files beside the session artifact', () => {
    const artifact = join('C:\\Users\\eddy\\.dsh\\sessions', 'project', 'session-test', 'session.jsonl.zstd')
    const result = resolveTopicDataDir({ locate: () => ({ path: artifact }) }, header, 'verifier')
    expect(result).toBe(join(dirname(artifact), 'verifier'))
  })

  it('rejects paths that escape the topic directory', () => {
    const locator = { locate: () => ({ path: join('C:\\data', 'session-test', 'session.jsonl') }) }
    expect(() => resolveTopicDataDir(locator, header, '..\\shared')).toThrow(/inside the topic directory/u)
    expect(() => resolveTopicDataDir(locator, header, 'C:\\shared')).toThrow(/relative/u)
  })

  it('fails closed when the backend cannot locate a topic artifact', () => {
    expect(() => resolveTopicDataDir({ locate: () => undefined }, header, 'verifier')).toThrow(/does not expose/u)
  })
})
