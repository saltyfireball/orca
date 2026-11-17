import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  limitResumeMemosPath,
  parseLimitResumeMemos,
  readLimitResumeMemos,
  writeLimitResumeMemos
} from './limit-resume-memos'

let dir: string | null = null
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = null
  }
})

describe('limit resume memos', () => {
  it('round-trips through the file, private to the user', async () => {
    dir = await mkdtemp(join(tmpdir(), 'limit-resume-'))
    const path = limitResumeMemosPath(dir)
    const memos = new Map([
      ['a:1', { tries: 2, answeredLine: 'x', answeredOccurrences: 1, resumedAt: 5, at: 6 }]
    ])
    await writeLimitResumeMemos(path, memos)
    expect(await readLimitResumeMemos(path)).toEqual(memos)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
  })

  it('starts empty on a missing or broken file and drops malformed fields', async () => {
    dir = await mkdtemp(join(tmpdir(), 'limit-resume-'))
    const path = limitResumeMemosPath(dir)
    expect((await readLimitResumeMemos(path)).size).toBe(0)
    await writeFile(path, '{not json')
    expect((await readLimitResumeMemos(path)).size).toBe(0)
    expect(
      parseLimitResumeMemos(
        JSON.stringify({ panes: { 'a:1': { tries: -1, cancelled: 'yes', at: 3 }, '': {} } })
      )
    ).toEqual(new Map([['a:1', { tries: 0, at: 3 }]]))
  })
})
