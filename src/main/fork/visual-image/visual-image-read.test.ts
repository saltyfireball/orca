import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setForkVisualFallbackSettingsReader } from '../../../shared/fork/visual-image-fallback'
import { nativeChatScratchFolderFor } from '../../native-chat/conversation-files/native-chat-scratch-folder'
import { readNativeChatVisualFile } from '../../native-chat/conversation-files/native-chat-visual-file-read'
import { ReadVisualParams } from '../../../shared/rpc-contract/structured-agent-session/agent-session-visual-params'
import { forkVisualImageDocument, sniffForkVisualImageType } from './visual-image-document'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const GIF = Buffer.from('GIF89a\u0001\u0000', 'latin1')
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 0, 0, 0]),
  Buffer.from('WEBPVP8 ')
])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

let stateDirectory: string
let folder: string
let settings: Record<string, unknown> = {}

beforeEach(async () => {
  settings = {}
  setForkVisualFallbackSettingsReader(() => settings)
  stateDirectory = await mkdtemp(join(tmpdir(), 'orca-visual-image-'))
  folder = nativeChatScratchFolderFor(stateDirectory, 'session-alpha')
  await mkdir(folder, { recursive: true })
})

afterEach(async () => {
  setForkVisualFallbackSettingsReader(() => null)
  await rm(stateDirectory, { recursive: true, force: true })
})

describe('sniffForkVisualImageType', () => {
  it('names the type from the bytes and nothing else', () => {
    expect(sniffForkVisualImageType(PNG)).toBe('image/png')
    expect(sniffForkVisualImageType(JPEG)).toBe('image/jpeg')
    expect(sniffForkVisualImageType(GIF)).toBe('image/gif')
    expect(sniffForkVisualImageType(WEBP)).toBe('image/webp')
    expect(sniffForkVisualImageType(SVG)).toBeNull()
    expect(sniffForkVisualImageType(Buffer.from('RIFF0000WAVE'))).toBeNull()
    expect(sniffForkVisualImageType(Buffer.alloc(0))).toBeNull()
  })
})

describe('forkVisualImageDocument', () => {
  it('leaves .html names to the stock path', () => {
    expect(forkVisualImageDocument('chart.html', PNG)).toBeNull()
  })

  it('inlines the image under its sniffed type, not its extension', () => {
    const result = forkVisualImageDocument('photo.jpg', PNG)
    expect(result).toEqual({ html: expect.stringContaining('src="data:image/png;base64,') })
    expect(result && 'html' in result && result.html).toContain(PNG.toString('base64'))
  })

  it('refuses SVG and other bytes behind an image name', () => {
    expect(forkVisualImageDocument('logo.png', SVG)).toEqual({ refusal: 'not_text' })
  })
})

describe('readNativeChatVisualFile with image files', () => {
  it('answers an image as a page that inlines it', async () => {
    await writeFile(join(folder, 'cassie-hair-2324.jpg'), JPEG)
    const result = await readNativeChatVisualFile(folder, 'cassie-hair-2324.jpg')
    expect(result.ok).toBe(true)
    expect(result.ok && 'html' in result && result.html).toContain('data:image/jpeg;base64,')
  })

  it('refuses an SVG renamed to .png', async () => {
    await writeFile(join(folder, 'logo.png'), SVG)
    expect(await readNativeChatVisualFile(folder, 'logo.png')).toEqual({
      ok: false,
      error: 'not_text'
    })
  })

  it('caps images by their own setting', async () => {
    settings = { forkVisualImageMaxMiB: 1 }
    await writeFile(join(folder, 'big.png'), Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))
    expect(await readNativeChatVisualFile(folder, 'big.png')).toEqual({
      ok: false,
      error: 'too_large'
    })
    settings = { forkVisualImageMaxMiB: 2 }
    expect((await readNativeChatVisualFile(folder, 'big.png')).ok).toBe(true)
  })

  it('keeps the stock cap for .html files', async () => {
    await writeFile(join(folder, 'big.html'), 'x'.repeat(600 * 1024))
    expect(await readNativeChatVisualFile(folder, 'big.html')).toEqual({
      ok: false,
      error: 'too_large'
    })
  })

  it.skipIf(process.platform === 'win32')('refuses a symlinked image', async () => {
    const outside = join(stateDirectory, 'outside.png')
    await writeFile(outside, PNG)
    await symlink(outside, join(folder, 'link.png'))
    expect(await readNativeChatVisualFile(folder, 'link.png')).toEqual({
      ok: false,
      error: 'outside_folder'
    })
  })

  it('refuses images when the setting is off, at the reader and the RPC params', async () => {
    settings = { forkVisualFallback: false }
    await writeFile(join(folder, 'photo.png'), PNG)
    expect(await readNativeChatVisualFile(folder, 'photo.png')).toEqual({
      ok: false,
      error: 'outside_folder'
    })
    expect(
      ReadVisualParams.safeParse({ sessionId: 'session-alpha', file: 'photo.png' }).success
    ).toBe(false)
    settings = {}
    expect(
      ReadVisualParams.safeParse({ sessionId: 'session-alpha', file: 'photo.png' }).success
    ).toBe(true)
  })
})
