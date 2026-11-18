// Visual fallback (FORK.md, SLRM-2349): the host reader's hook for image files. The name says
// image, but only the first bytes decide the type; SVG and anything else is refused. The answer
// is a small HTML page with the image inlined as a data: URL, which every client shows through
// its existing sandboxed visual frame.
import { isForkVisualImageName } from '../../../shared/fork/visual-image-fallback'

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return (
    bytes.length >= offset + prefix.length &&
    prefix.every((byte, index) => bytes[offset + index] === byte)
  )
}

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0))

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87 = ascii('GIF87a')
const GIF89 = ascii('GIF89a')
const RIFF = ascii('RIFF')
const WEBP = ascii('WEBP')

/** The type the bytes prove, never the name's extension; null for anything else. */
export function sniffForkVisualImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG)) {
    return 'image/png'
  }
  if (startsWith(bytes, JPEG)) {
    return 'image/jpeg'
  }
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) {
    return 'image/gif'
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return 'image/webp'
  }
  return null
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

export type ForkVisualImageDocument = { html: string } | { refusal: 'not_text' }

/**
 * Null for a name that is not an image (the stock .html path goes on), a page that inlines the
 * image, or a refusal when the bytes are not a PNG, JPEG, GIF or WebP.
 */
export function forkVisualImageDocument(
  name: string,
  bytes: Buffer
): ForkVisualImageDocument | null {
  if (!isForkVisualImageName(name)) {
    return null
  }
  const type = sniffForkVisualImageType(bytes)
  if (!type) {
    return { refusal: 'not_text' }
  }
  const label = escapeHtml(name)
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${label}</title>`,
    '<style>html,body{margin:0;padding:0;background:transparent}',
    'img{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body>',
    `<img alt="${label}" src="data:${type};base64,${bytes.toString('base64')}">`,
    '</body></html>'
  ].join('')
  return { html }
}
