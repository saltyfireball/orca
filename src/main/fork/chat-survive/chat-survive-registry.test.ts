import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  chatSurviveRecordsSettled,
  removeChatSurviveRecord,
  writeChatSurviveRecord
} from './chat-survive-registry'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('chat-survive record queue', () => {
  it('settles once a removal queued behind a write has landed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csreg-'))
    dirs.push(dir)
    const path = join(dir, 'records', 'one.json')
    const record = { v: 1 as const, sessionId: 's', brokerPid: 1, socketPath: 'x', token: 't' }
    // Neither is awaited, as at a provider's exit during quit.
    void writeChatSurviveRecord(path, record, { privateDir: true })
    void removeChatSurviveRecord(path)
    await chatSurviveRecordsSettled()
    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(dir, 'records'))).toBe(true)
  })

  it('settles at once with nothing queued, and after a failed write', async () => {
    await expect(chatSurviveRecordsSettled()).resolves.toBeUndefined()
    const record = { v: 1 as const, sessionId: 's', brokerPid: 1, socketPath: 'x', token: 't' }
    const failed = writeChatSurviveRecord(join(tmpdir(), 'csreg-missing-', 'no', 'r.json'), record)
    await expect(chatSurviveRecordsSettled()).resolves.toBeUndefined()
    await expect(failed).rejects.toThrow()
  })
})
