// Session export (FORK.md, BAD-688): `orca agent export` writes a redacted file by default and only
// shares when asked, always redacted.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import type { SessionExportDocument } from '../../shared/fork/session-export/session-export'
import { FORK_SESSION_EXPORT_HANDLERS } from './session-export-handlers'

const doc: SessionExportDocument = {
  id: 'orca_session_id:aaaaaaaa-1111-4111-8111-111111111111',
  kind: 'chat',
  agent: 'claude',
  title: 'Deploy',
  truncated: false,
  homeDirs: ['/Users/sam'],
  entries: [
    { role: 'user', text: 'Deploy with API_TOKEN=abcdef123456 from /Users/sam/app' },
    { role: 'assistant', text: 'Done.' }
  ]
}

let dir: string
let calls: { method: string; params: unknown }[]
let settings: Record<string, unknown>

function context(flags: Record<string, string | true>): HandlerContext {
  const client = {
    isRemote: false,
    call: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (method === 'settings.get') {
        return { result: { settings } }
      }
      if (method === 'fork.sessionExport.read') {
        return { id: 'r', ok: true, result: doc }
      }
      return { result: { status: 'ok', value: { shareUrl: 'https://share.example/a/xyz' } } }
    })
  }
  return {
    flags: new Map(Object.entries({ id: doc.id, ...flags })),
    client,
    cwd: dir,
    json: false
  } as unknown as HandlerContext
}

const run = (flags: Record<string, string | true>) =>
  FORK_SESSION_EXPORT_HANDLERS['agent export'](context(flags))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-export-'))
  calls = []
  settings = {}
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('orca agent export', () => {
  it('writes a redacted Markdown file named after the session by default', async () => {
    await run({})
    expect(await readFile(join(dir, 'orca-session-aaaaaaaa.md'), 'utf8')).toContain(
      'Deploy with API_TOKEN=[redacted] from ~/app'
    )
    expect(calls.map((call) => call.method)).not.toContain('artifacts.share')
  })

  it('keeps the text as it is with --no-redact', async () => {
    await run({ 'no-redact': true, out: 'raw.md' })
    expect(await readFile(join(dir, 'raw.md'), 'utf8')).toContain('API_TOKEN=abcdef123456')
  })

  it('does not redact by default when the setting is off', async () => {
    settings = { forkSessionExportRedact: false }
    await run({ out: 'raw.md' })
    expect(await readFile(join(dir, 'raw.md'), 'utf8')).toContain('/Users/sam/app')
  })

  it('shares the redacted file and prints the link', async () => {
    settings = { forkSessionExportRedact: false }
    await run({ share: true, format: 'html', out: 'shared.html' })
    const share = calls.find((call) => call.method === 'artifacts.share')
    const body = share?.params as { content: string; contentType: string }
    expect(body.contentType).toBe('text/html')
    expect(body.content).toContain('API_TOKEN=[redacted]')
    expect(body.content).not.toContain('/Users/sam')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('https://share.example/a/xyz'))
  })

  it('refuses to share unredacted, as JSON, or when sharing is off', async () => {
    await expect(run({ share: true, 'no-redact': true })).rejects.toThrow('always redacted')
    await expect(run({ share: true, format: 'json' })).rejects.toThrow('Only md and html')
    settings = { artifactSharingEnabled: false }
    await expect(run({ share: true })).rejects.toThrow()
    expect(calls.map((call) => call.method)).not.toContain('artifacts.share')
  })
})
