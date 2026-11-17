import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { forkUpdateWatchdogArgs } from './server-update-restart'

let root = ''

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

// Runs the real watchdog script in the foreground; the "restart" only appends to a log.
function runWatchdog(markText: string | null) {
  root = mkdtempSync(join(tmpdir(), 'fork-update-watchdog-'))
  const install = join(root, 'server')
  const previous = join(root, 'work', 'previous')
  mkdirSync(install, { recursive: true })
  mkdirSync(previous, { recursive: true })
  writeFileSync(join(install, 'v'), 'new')
  writeFileSync(join(previous, 'v'), 'old')
  const mark = join(root, 'ready')
  if (markText !== null) {
    writeFileSync(mark, markText)
  }
  const log = join(root, 'restarts')
  const args = forkUpdateWatchdogArgs({
    readyMark: mark,
    want: 'job-7',
    readySeconds: 1,
    rollback: true,
    installPath: install,
    previousPath: previous,
    failedPath: join(root, 'work', 'failed'),
    brakePath: join(root, 'brake.json'),
    restart: ['/bin/sh', '-c', 'echo restart >> "$0"', log]
  })
  const result = spawnSync('/bin/sh', args, { encoding: 'utf8', timeout: 10_000 })
  return {
    status: result.status,
    installed: readFileSync(join(install, 'v'), 'utf8'),
    restarts: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0,
    failedKept: existsSync(join(root, 'work', 'failed', 'v'))
  }
}

describe('fork update watchdog', () => {
  it('keeps the new install once the new server writes its job id', () => {
    expect(runWatchdog('job-7')).toEqual({
      status: 0,
      installed: 'new',
      restarts: 1,
      failedKept: false
    })
  })

  it('puts the old install back and restarts again when no ready mark for this job comes', () => {
    expect(runWatchdog('job-6')).toEqual({
      status: 2,
      installed: 'old',
      restarts: 2,
      failedKept: true
    })
  })
})
