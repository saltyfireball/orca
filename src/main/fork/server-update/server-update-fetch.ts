// Server updates (FORK.md, SLRM-2310): downloads. Every request and every redirect it follows must
// stay on https (or loopback http for a local feed), every body has a size cap, and a file is
// hashed as it is written so nothing is read back before it is checked. Tests pass a fake fetch.
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { normalizeForkReleasesUrl } from '../../../shared/fork/server-update'

export type ForkFetchResponse = {
  ok: boolean
  status: number
  url: string
  body: ReadableStream<Uint8Array> | null
}

export type ForkFetch = (url: string, init: { signal?: AbortSignal }) => Promise<ForkFetchResponse>

export const FORK_MANIFEST_MAX_BYTES = 1024 * 1024
export const FORK_RELEASE_MAX_BYTES = 1024 * 1024 * 1024

const MAX_REDIRECTS = 5

/** Follows redirects itself, so a hop to anything but https is refused before it is fetched. */
export const defaultForkFetch: ForkFetch = async (url, init) => {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: init.signal })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return { ok: response.ok, status: response.status, url: current, body: response.body }
    }
    await response.body?.cancel()
    const next = new URL(location, current)
    if (next.protocol !== 'https:') {
      throw new Error(`refusing a redirect from ${url} to a non-https address`)
    }
    current = next.toString()
  }
  throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times`)
}

async function request(
  fetchImpl: ForkFetch,
  url: string,
  signal: AbortSignal | undefined
): Promise<ReadableStream<Uint8Array>> {
  if (!normalizeForkReleasesUrl(url)) {
    throw new Error(`refusing to download from ${url}: not https`)
  }
  const response = await fetchImpl(url, { signal })
  // A redirect to plain http (or anything else) would let the network swap the file.
  if (response.url && !normalizeForkReleasesUrl(response.url.split('?')[0])) {
    throw new Error(`refusing a redirect from ${url} to a non-https address`)
  }
  if (!response.ok || !response.body) {
    throw new Error(`could not download ${url} (HTTP ${response.status})`)
  }
  return response.body
}

async function* chunks(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  url: string
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`${url} is larger than ${maxBytes} bytes`)
      }
      yield value
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export async function fetchForkText(
  fetchImpl: ForkFetch,
  url: string,
  signal?: AbortSignal
): Promise<string> {
  const parts: Uint8Array[] = []
  for await (const chunk of chunks(
    await request(fetchImpl, url, signal),
    FORK_MANIFEST_MAX_BYTES,
    url
  )) {
    parts.push(chunk)
  }
  return Buffer.concat(parts).toString('utf8')
}

/** Writes a new file (never an existing one) and returns its digest in `encoding`. */
export async function downloadForkFile(
  fetchImpl: ForkFetch,
  url: string,
  dest: string,
  hash: { algorithm: 'sha256' | 'sha512'; encoding: 'hex' | 'base64' },
  signal?: AbortSignal
): Promise<string> {
  const body = await request(fetchImpl, url, signal)
  const digest = createHash(hash.algorithm)
  const file = await open(dest, 'wx', 0o600)
  try {
    for await (const chunk of chunks(body, FORK_RELEASE_MAX_BYTES, url)) {
      digest.update(chunk)
      await file.write(chunk)
    }
  } finally {
    await file.close()
  }
  return digest.digest(hash.encoding)
}
