// BAD-818 proof on a server with no desktop app: two release orcads. `home` coordinates and has `lab`
// paired; `lab` is the paused server a worker-start --on places a chat worker on. A stand-in `claude`
// speaks Claude's stream-json protocol and records each start, the folder it ran in and each message
// it was given. Run with `pnpm build:orcad` first and
// ORCA_BUILT_ORCAD_TEST=1.
import { chmodSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  builtOrcadTestEnabled,
  initDemoRepo,
  orcadLab,
  settle,
  type OrcadLab
} from '../orcad-release.test-fixture'

const AGENT_SOURCE = (folder: string) => `
const fs = require('node:fs')
const file = ${JSON.stringify(folder)} + '/' + process.pid
fs.writeFileSync(file + '.cwd', process.cwd())
const session = (process.argv.find((arg) => /^--(session-id|resume)=/.test(arg)) || '=stand-in').split('=')[1]
const say = (frame) => process.stdout.write(JSON.stringify(Object.assign({ session_id: session }, frame)) + '\\n')
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'control_request') {
    const settings = frame.request.subtype === 'get_settings'
    say({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: settings ? { model: 'claude-sonnet-5', permissionMode: 'default' } : { commands: [], models: [], capabilities: ['msg_lifecycle_v1'] } } })
    if (frame.request.subtype === 'initialize') {
      say({ type: 'system', subtype: 'init', uuid: 'init', model: 'claude-sonnet-5' })
    }
  } else if (frame.type === 'user') {
    fs.appendFileSync(file + '.messages', JSON.stringify(frame.message) + '\\n')
    say(Object.assign({}, frame, { isReplay: true }))
    say({ type: 'result', subtype: 'success', uuid: 'result', is_error: false, result: 'pong', duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [] })
  }
})
`
let lab: OrcadLab
let repo = ''

/** Starts of the worker's agent: in its workspace (the host's own probes run elsewhere). */
function starts(): number {
  const folder = join(lab.root, 'starts')
  return readdirSync(folder)
    .filter((name) => name.endsWith('.cwd'))
    .filter((name) => readFileSync(join(folder, name), 'utf8').includes('paused-worker')).length
}

/** Messages the worker's agents were given. */
function messages(): string[] {
  const folder = join(lab.root, 'starts')
  return readdirSync(folder)
    .filter((name) => name.endsWith('.messages'))
    .flatMap((name) => readFileSync(join(folder, name), 'utf8').trim().split('\n'))
}

function queued(): {
  sessionId: string
  dispatchId?: string
  heldReason?: string
  kind: string
}[] {
  return lab.result(['agent', 'queue', 'list'], 'lab').entries as {
    sessionId: string
    dispatchId?: string
    heldReason?: string
    kind: string
  }[]
}

describe.skipIf(!builtOrcadTestEnabled)(
  'pause-all holds a chat worker on orcad (release build)',
  () => {
    let dispatchId = ''

    beforeAll(async () => {
      lab = orcadLab('orcad-pause-')
      mkdirSync(join(lab.root, 'starts'))
      const agent = join(lab.root, 'bin', 'claude-stand-in.cjs')
      writeFileSync(agent, AGENT_SOURCE(join(lab.root, 'starts')))
      writeFileSync(
        join(lab.root, 'bin', 'claude'),
        `#!/bin/sh\n[ "$1" = --version ] && { echo '2.1.331 (Claude Code)'; exit 0; }\nexec '${process.execPath}' '${agent}' "$@"\n`
      )
      chmodSync(join(lab.root, 'bin', 'claude'), 0o755)
      repo = join(lab.root, 'repo')
      initDemoRepo(repo)
      await lab.start('home')
      lab.pair('lab', await lab.start('lab'))
      lab.result(['repo', 'add', '--path', repo])
      lab.result(['repo', 'add', '--path', repo], 'lab')
      // Workers of this agent start as native chats on both.
      for (const environment of [undefined, 'lab']) {
        lab.result(
          ['settings', 'set', 'nativeChatProviders', JSON.stringify({ claude: true })],
          environment
        )
      }
    }, 240_000)

    afterAll(async () => {
      await lab?.close()
    }, 60_000)

    it('a chat worker-start --on a paused server waits in its launch queue with the reason', async () => {
      lab.result(['pause-all', '--hosts', 'local'], 'lab')
      const shell = lab.result(['terminal', 'create', '--worktree', `path:${repo}`]) as {
        handle?: string
        terminal?: { handle: string }
      }
      const started = lab.result([
        'orchestration',
        'worker-start',
        '--from',
        shell.handle ?? shell.terminal!.handle,
        '--on',
        'lab',
        '--agent',
        'claude',
        '--repo',
        `path:${repo}`,
        '--worktree',
        'new-child',
        '--name',
        'paused-worker',
        '--spec',
        'Reply with the word pong.'
      ]) as { dispatchId: string; mode: string }
      expect(started.mode).toBe('structured')
      dispatchId = started.dispatchId
      await settle(5000)
      expect(starts()).toBe(0)
      expect(queued()).toEqual([
        expect.objectContaining({ dispatchId, kind: 'worker', heldReason: 'paused by pause-all' })
      ])
      expect(lab.cli(['pause-status', '--hosts', 'local'], 'lab').text).toContain('"launches": 1')
    }, 180_000)

    it('the held launch is still held after the server restarts, and starts once at resume-all with its Task', async () => {
      await lab.stop('lab')
      await lab.start('lab')
      await settle(10_000)
      expect(starts()).toBe(0)
      expect(queued()).toEqual([
        expect.objectContaining({ dispatchId, kind: 'worker', heldReason: 'paused by pause-all' })
      ])
      expect(lab.cli(['pause-status', '--hosts', 'local'], 'lab').text).toContain('"launches": 1')
      const held = queued()
      // A look at the held chat opens it; a second restart then opens it again.
      lab.cli(['agent', 'read', held[0].sessionId], 'lab')
      await settle(3000)
      await lab.stop('lab')
      await lab.start('lab')
      await settle(10_000)
      expect(queued()).toEqual(held.map(() => expect.objectContaining({ dispatchId })))
      expect(starts()).toBe(0)
      expect(messages()).toEqual([])
      lab.result(['resume-all', '--hosts', 'local'], 'lab')
      for (let waited = 0; starts() === 0 && waited < 30_000; waited += 500) {
        await settle(500)
      }
      for (let waited = 0; messages().length === 0 && waited < 30_000; waited += 500) {
        await settle(500)
      }
      await settle(5000)
      expect(starts()).toBe(1)
      expect(messages()).toEqual([expect.stringContaining('Reply with the word pong.')])
      expect(queued()).toEqual([])
    }, 180_000)
  }
)
