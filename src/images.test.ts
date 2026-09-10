import { describe, expect, it } from 'vitest'
import { isBlockedImageHost, loadVerifierImages } from './images.ts'

describe('verifier image evidence', () => {
  it('accepts a base64 data URL', async () => {
    const images = await loadVerifierImages(['data:image/png;base64,' + Buffer.from('png-bytes').toString('base64')])
    expect(images).toHaveLength(1)
    expect(images[0]!.mediaType).toBe('image/png')
    expect(Buffer.from(images[0]!.data).toString()).toBe('png-bytes')
  })

  it('rejects non-HTTPS remote sources', async () => {
    await expect(loadVerifierImages(['http://example.test/a.png'])).rejects.toThrow(/HTTPS/)
    await expect(loadVerifierImages(['file:///etc/passwd'])).rejects.toThrow(/HTTPS/)
  })

  it('refuses loopback and link-local hosts', async () => {
    await expect(loadVerifierImages(['https://127.0.0.1/a.png'])).rejects.toThrow(/loopback or link-local/)
    await expect(loadVerifierImages(['https://169.254.169.254/latest/meta-data/'])).rejects.toThrow(/loopback or link-local/)
    await expect(loadVerifierImages(['https://localhost/a.png'])).rejects.toThrow(/loopback or link-local/)
    expect(isBlockedImageHost('[::1]')).toBe(true)
    expect(isBlockedImageHost('artifacts.internal.example')).toBe(false)
    expect(isBlockedImageHost('10.0.0.7')).toBe(false)
  })
})
