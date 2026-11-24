// BAD-764 against the real Claude Code CLI: a shell command given to a tool other than Bash is read on
// both surfaces. A chat has the in-Orca hook; the terminal has Orca's managed hook script, posting to
// the real hook server. Runs only with ORCA_COMMAND_GUARDS_E2E=1.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOOK_AROUND_REFUSAL } from '../../bots/bot-look-around-policy'
import { AgentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { CLAUDE_EVENTS } from '../../claude/hooks/claude-managed-hook-events'
import { getManagedScript } from '../../claude/hooks/hook-script'
import { claudeReadOnlyOptions } from '../../claude/claude-structured-read-only-options'
import { listCommandGuardAudit } from './command-guards-audit'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkChatGuardOptions } from './command-guards-native-chat'
import {
  askForTool,
  BYPASS,
  REAL_CLAUDE_ENABLED,
  runRealClaude,
  type RealOptions
} from './command-guards-real-claude.test-fixture'

vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

const FORCE = 'git push --force origin main'
const DENIED = "Blocked by Orca's command guard (force-push)"
let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'guard-tools-'))
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  appendFileSync(join(scratch, 'build.log'), 'the log line\n')
  startForkCommandGuards({ requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] }) })
})
afterEach(() => {
  stopForkCommandGuards()
  resetCommandGuardChats()
  rmSync(scratch, { recursive: true, force: true })
})

const guarded = (options: RealOptions): RealOptions =>
  forkChatGuardOptions(options, 'real-claude-tools', scratch)

const ask = (options: RealOptions, content: string, env?: Record<string, string>) =>
  runRealClaude({ cwd: scratch, options, content, env })

const follow = (): string => askForTool('Monitor', `tail -f ${join(scratch, 'build.log')}`)

describe.skipIf(!REAL_CLAUDE_ENABLED || process.platform !== 'darwin')(
  'shell commands of other tools, native chat against the real Claude Code',
  () => {
    it('denies a Monitor call with a force push', async () => {
      expect(await ask(guarded(BYPASS), askForTool('Monitor', FORCE))).toContain(DENIED)
      expect(listCommandGuardAudit(1)[0]).toMatchObject({ rule: 'force-push', command: FORCE })
    }, 150_000)

    it('runs an ordinary Monitor command', async () => {
      const said = await ask(guarded(BYPASS), follow())
      expect(said).toContain('"name":"Monitor"')
      expect(said).toContain('Monitor started')
      expect(said).not.toContain('command guard')
    }, 150_000)

    it('a look-around decides Monitor by its own rule', async () => {
      const options = guarded({ ...BYPASS, ...claudeReadOnlyOptions() })
      const said = await ask(options, askForTool('Monitor', 'orca bot list'))
      expect(said).toContain('"name":"Monitor"')
      expect(said).toContain(LOOK_AROUND_REFUSAL)
    }, 150_000)
  }
)

describe.skipIf(!REAL_CLAUDE_ENABLED || process.platform !== 'darwin')(
  'shell commands of other tools, the terminal hook against the real Claude Code',
  () => {
    const server = new AgentHookServer()
    afterEach(() => server.stop())

    /** A terminal's Claude Code: Orca's hook script, posting as that pane. */
    async function terminal(): Promise<{ options: RealOptions; env: Record<string, string> }> {
      await server.start({ env: 'production' })
      const script = join(scratch, 'claude-hook.sh')
      writeFileSync(script, getManagedScript('posix', { decidesPreToolUse: true }), { mode: 0o755 })
      const event = CLAUDE_EVENTS.find((entry) => entry.eventName === 'PreToolUse')
      const hooks = [{ type: 'command', command: `/bin/sh '${script}'` }]
      const settings = join(scratch, 'settings.json')
      writeFileSync(
        settings,
        JSON.stringify({ hooks: { PreToolUse: [{ ...event?.definition, hooks }] } })
      )
      return {
        options: { ...BYPASS, settings },
        env: {
          ...server.buildPtyEnv(),
          ORCA_PANE_KEY: 'tab-guard:11111111-1111-4111-8111-111111111111',
          ORCA_TAB_ID: 'tab-guard',
          ORCA_WORKTREE_ID: `repo-1::${scratch}`
        }
      }
    }

    it('denies a Monitor call with a force push', async () => {
      const { options, env } = await terminal()
      expect(await ask(options, askForTool('Monitor', FORCE), env)).toContain(DENIED)
      expect(listCommandGuardAudit(1)[0]).toMatchObject({ surface: 'terminal', command: FORCE })
    }, 150_000)

    it('runs an ordinary Monitor command', async () => {
      const { options, env } = await terminal()
      const said = await ask(options, follow(), env)
      expect(said).toContain('Monitor started')
      expect(said).not.toContain('command guard')
    }, 150_000)
  }
)
