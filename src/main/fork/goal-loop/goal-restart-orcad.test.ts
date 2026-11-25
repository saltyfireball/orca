// BAD-833 proof on a server with no desktop app: the release orcad, its terminal daemon and a real
// PTY that outlives an orcad restart, as on a real server. The stand-in agent is a program named
// `claude` that reports its turns through the Claude hooks orcad installed (UserPromptSubmit, then
// Stop), takes lines at a prompt and writes a note for each, so the goal's check keeps failing with
// progress. It draws Claude's titles (the rest glyph, a spinner in a turn) only once `titles` exists,
// so after the restart its rest cannot be seen at first: the terminal gate answers "unsettled".
// Before the fix the goal counted each of those as a refused send and stopped as "agent not
// reachable" about 50 seconds after the restart. Run with `pnpm build:orcad` first and
// ORCA_BUILT_ORCAD_TEST=1.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  builtOrcadTestEnabled,
  initDemoRepo,
  orcadLab,
  settle,
  type OrcadLab
} from '../orcad-release.test-fixture'

const AGENT_SOURCE = (log: string, titles: string) => `
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude')
const session = 'stand-in-' + process.pid
function hook(event, extra) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    for (const group of (settings.hooks && settings.hooks[event]) || []) {
      for (const entry of group.hooks || []) {
        execSync(entry.command, {
          input: JSON.stringify(Object.assign({ hook_event_name: event, session_id: session, cwd: process.cwd(), transcript_path: '' }, extra || {})),
          stdio: ['pipe', 'ignore', 'ignore'],
          shell: '/bin/sh',
          timeout: 15000
        })
      }
    }
  } catch {}
}
let drawn = false
function title(glyph) {
  if (fs.existsSync(${JSON.stringify(titles)})) {
    drawn = true
    process.stdout.write('\\x1b]0;' + glyph + ' Claude Code\\x07')
  }
}
hook('SessionStart', { source: 'startup' })
process.stdout.write('> ')
hook('Stop')
let turn = 0
process.stdin.on('data', (data) => {
  const text = String(data).trim()
  if (!text) return
  turn += 1
  hook('UserPromptSubmit', { prompt: text })
  title('\\u280b')
  fs.appendFileSync(${JSON.stringify(log)}, text.slice(0, 60).replace(/\\s+/g, ' ') + '\\n')
  fs.writeFileSync(path.join(process.cwd(), 'notes.txt'), 'turn ' + turn + '\\n')
  process.stdout.write('ok\\r\\n')
  title('\\u2733')
  process.stdout.write('> ')
  hook('Stop')
})
// At rest: the rest title appears once titles are on.
setInterval(() => drawn || title('\\u2733'), 1000)
`

let lab: OrcadLab
let repo = ''
let log = ''
let paneKey = ''

function received(): number {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

function goal(): { status: string; stop?: { reason: string; text: string }; rounds: number } {
  const goals = lab.result(['goal', 'list'], 'lab').goals as {
    id: string
    status: string
    stop?: { reason: string; text: string }
    rounds: number
  }[]
  return goals.find((entry) => entry.id === paneKey)!
}

async function waitFor(done: () => boolean, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 1000) {
    if (done()) {
      return true
    }
    await settle(1000)
  }
  return done()
}

describe.skipIf(!builtOrcadTestEnabled)(
  'a goal on an idle terminal agent across a server restart (release build)',
  () => {
    let titles = ''

    beforeAll(async () => {
      lab = orcadLab('orcad-goal-')
      repo = join(lab.root, 'repo')
      log = join(lab.root, 'received.log')
      titles = join(lab.root, 'titles')
      initDemoRepo(repo)
      writeFileSync(join(lab.root, 'agent.js'), AGENT_SOURCE(log, titles))
      // On PATH as `claude`, so orcad finds the CLI and installs its hooks at start-up.
      const claude = join(lab.root, 'bin', 'claude')
      writeFileSync(
        claude,
        `#!/bin/bash\n[ "$1" = --version ] && { echo '2.1.331 (Claude Code)'; exit 0; }\nexec -a claude "${process.execPath}" "${join(lab.root, 'agent.js')}"\n`
      )
      chmodSync(claude, 0o755)
      lab.pair('lab', await lab.start('lab'))
      lab.result(['repo', 'add', '--path', repo], 'lab')
      lab.result(['settings', 'set', 'forkGoalLoopIdleSeconds', '5'], 'lab')
    }, 240_000)

    afterAll(async () => {
      await lab?.close()
    }, 60_000)

    it('waits while the agent cannot be seen at rest after the restart, then goes on, and is not stopped as not reachable', async () => {
      const created = lab.result(
        ['terminal', 'create', '--worktree', `path:${repo}`, '--command', 'claude'],
        'lab'
      ) as { terminal?: { paneKey?: string }; paneKey?: string }
      paneKey = created.terminal?.paneKey ?? created.paneKey ?? ''
      expect(paneKey).not.toBe('')
      // The agent reports itself idle through its hooks; the goal can be set once it is listed.
      let refused = ''
      const set = await waitFor(() => {
        const run = lab.cli(
          ['goal', 'set', '--id', paneKey, '--until-cmd', 'test -f done.txt', '--max-rounds', '50'],
          'lab'
        )
        refused = run.text
        return run.ok
      }, 60_000)
      expect(set, refused).toBe(true)
      expect(await waitFor(() => received() >= 1, 90_000)).toBe(true)

      // Its turn ends (Stop) before the server goes down: an idle agent across the restart.
      await settle(3000)
      await lab.stop('lab')
      await lab.start('lab')
      const before = received()
      // Past the five refused sends (one a sweep, about 50 seconds) the goal still waits.
      await settle(90_000)
      expect(goal()).toMatchObject({ status: 'active' })
      // The agent is seen at rest: the goal goes on with the next continue message.
      writeFileSync(titles, '')
      const went = await waitFor(() => received() > before, 90_000)
      expect(went, JSON.stringify(goal())).toBe(true)
      expect(goal()).toMatchObject({ status: 'active' })
    }, 480_000)
  }
)
