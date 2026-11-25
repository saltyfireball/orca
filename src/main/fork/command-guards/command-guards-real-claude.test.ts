// BAD-764 against the real Claude Code CLI: a chat in Full access (bypassPermissions) is asked to run
// a force push in a scratch repo (no remote, so it would fail harmlessly anyway). The guard's hook must
// deny it before the tool runs. BAD-795 adds read-only runs and how Claude Code combines the answers of
// several PreToolUse hooks. It costs some (Haiku) turns and needs the user's login, so it runs only
// with ORCA_COMMAND_GUARDS_E2E=1 (ORCA_COMMAND_GUARDS_E2E_CLAUDE names the CLI).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotLaunchTools } from '../../bots/bot-launch-tools'
import { REPLY_ONLY_REFUSAL } from '../../bots/bot-look-around-policy'
import { claudeBotSessionOptions } from '../../claude/structured/launch/claude-bot-session-options'
import { buildClaudePermissionCallbacks } from '../../claude/structured/permissions/claude-structured-inbound-control'
import {
  endGuardApps,
  ownGuardBroker,
  startGuardApp
} from './command-guards-app-process.test-fixture'
import { listCommandGuardAudit } from './command-guards-audit'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkChatGuardOptions } from './command-guards-native-chat'
import {
  askForTool,
  BYPASS,
  REAL_CLAUDE as CLAUDE,
  REAL_CLAUDE_ENABLED as enabled,
  runRealClaude,
  type RealOptions
} from './command-guards-real-claude.test-fixture'

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'guard-real-'))
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  // A stand-in `orca`, first on the chat's PATH.
  mkdirSync(join(scratch, 'bin'))
  writeFileSync(join(scratch, 'bin/orca'), '#!/bin/sh\necho "orca ran: $*"\n', { mode: 0o755 })
  startForkCommandGuards({ requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] }) })
})
afterEach(() => {
  endGuardApps()
  stopForkCommandGuards()
  resetCommandGuardChats()
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true })
  }
})

const runReal = (options: RealOptions, content: string, canUseTool?: CanUseTool): Promise<string> =>
  runRealClaude({ cwd: scratch, options, content, canUseTool })

const guarded = (options: RealOptions): RealOptions =>
  forkChatGuardOptions(options, 'real-claude-proof', scratch)

async function readOnly(mode: 'look-around' | 'reply-only'): Promise<RealOptions> {
  return claudeBotSessionOptions(
    { instructions: async () => null, readOnly: mode },
    [],
    BotLaunchTools.none,
    { mcpConfig: false }
  )
}

const run = (command: string): string => askForTool('Bash', command)

const SURVIVE_OWNER = join(import.meta.dirname, 'command-guards-survive-owner.test-fixture.ts')

/**
 * One chat across an app restart: the first app instance starts it and is SIGKILLed after its quit
 * hook, the second adopts the same Claude process. Returns the second.
 */
async function adopted(
  second: { startGuards?: boolean; readOnly?: boolean },
  first: { hang?: string } = {}
) {
  const base = {
    sessionId: `guard-e2e-${process.pid}-${Date.now()}`,
    recordDir: join(scratch, 'state', 'chat-survive'),
    cwd: scratch,
    claude: CLAUDE,
    readOnly: second.readOnly === true
  }
  const app = (config: Record<string, unknown>) =>
    startGuardApp(SURVIVE_OWNER, { GUARD_SURVIVE_CONFIG: JSON.stringify(config) }, 90_000)
  const before = app({ ...base, mode: 'first', hang: first.hang !== undefined })
  const brokerPid = Number((await before.next('pid')).pid)
  ownGuardBroker(brokerPid)
  await (first.hang === undefined
    ? before.ask('say Reply with the word ok and nothing else.', 'result')
    : before.ask(`say ${first.hang}`, 'hook-hangs'))
  expect((await before.ask('quit 3', 'detached')).ok).toBe(true)
  await before.kill()
  const after = app({ ...base, mode: 'adopt', brokerPid, ...second })
  expect((await after.next('adopted')).ok).toBe(true)
  expect((await after.next('pid')).pid).toBe(brokerPid)
  await after.next('init')
  return after
}

const answering =
  (permissionDecision: 'allow' | 'deny'): HookCallback =>
  async () => ({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      ...(permissionDecision === 'deny' ? { permissionDecisionReason: 'OTHER HOOK SAYS NO' } : {})
    }
  })

describe.skipIf(!enabled || process.platform !== 'darwin')(
  'command guard proof: native chat against the real Claude Code',
  () => {
    it('denies a force push to the default branch in Full access and audits it', async () => {
      const said = await runReal(guarded(BYPASS), run('git push --force origin main'))
      expect(said).toContain("Blocked by Orca's command guard (force-push)")
      expect(listCommandGuardAudit(1)[0]).toMatchObject({
        agent: 'claude',
        surface: 'native-chat',
        rule: 'force-push'
      })
    }, 150_000)

    it("another hook's allow does not lift a guard denial, in either order", async () => {
      const allows = [{ hooks: [answering('allow')] }]
      const after = guarded({ ...BYPASS, hooks: { PreToolUse: allows } })
      const guardAlone = guarded(BYPASS).hooks?.PreToolUse ?? []
      const before: RealOptions = { ...BYPASS, hooks: { PreToolUse: [...guardAlone, ...allows] } }
      for (const options of [after, before]) {
        expect(options.hooks?.PreToolUse).toHaveLength(2)
        const said = await runReal(options, run('git push --force origin main'))
        expect(said).toContain("Blocked by Orca's command guard (force-push)")
      }
    }, 300_000)

    it("the guard's silence does not lift another hook's denial, in either order", async () => {
      const denies = [{ hooks: [answering('deny')] }]
      const after = guarded({ ...BYPASS, hooks: { PreToolUse: denies } })
      const guardAlone = guarded(BYPASS).hooks?.PreToolUse ?? []
      const before: RealOptions = { ...BYPASS, hooks: { PreToolUse: [...guardAlone, ...denies] } }
      for (const options of [after, before]) {
        const said = await runReal(options, run('touch made-it'))
        expect(said).toContain('OTHER HOOK SAYS NO')
        expect(existsSync(join(scratch, 'made-it'))).toBe(false)
      }
    }, 300_000)

    it('a look-around reads, and stays denied, even in Full access', async () => {
      const options = guarded({ ...BYPASS, ...(await readOnly('look-around')) })
      expect(await runReal(options, run('orca bot list'))).toContain('orca ran: bot list')
      expect(await runReal(options, run('touch made-it'))).toMatch(
        /Looking around can only read.*Suggest this as a next step instead\./
      )
      expect(existsSync(join(scratch, 'made-it'))).toBe(false)
      const pushed = await runReal(options, run('git push --force origin main'))
      expect(pushed).toContain("Blocked by Orca's command guard (force-push)")
    }, 450_000)

    it('a look-around in its own permission mode reads with no prompt', async () => {
      const prompted = vi.fn<CanUseTool>(async () => ({ behavior: 'deny', message: 'PROMPTED' }))
      const options = guarded({
        model: 'haiku',
        settingSources: [],
        permissionMode: 'default',
        ...(await readOnly('look-around'))
      })
      expect(await runReal(options, run('orca bot list'), prompted)).toContain('orca ran: bot list')
      expect(prompted).not.toHaveBeenCalled()
    }, 150_000)

    it('a look-around prompt that still comes (an ask rule of the user) is refused at once', async () => {
      const emit = vi.fn()
      const { canUseTool } = buildClaudePermissionCallbacks({
        sessionId: 'real-claude-proof',
        prompts: {} as never,
        emit,
        fullAccessAt: () => false,
        readOnly: 'look-around'
      })
      const options = guarded({
        model: 'haiku',
        settingSources: [],
        permissionMode: 'default',
        ...(await readOnly('look-around')),
        settings: { permissions: { ask: ['Bash(orca bot list)'] } }
      })
      const said = await runReal(options, run('orca bot list'), canUseTool)
      expect(said).toMatch(/Looking around can only read.*Suggest this as a next step instead\./)
      expect(said).not.toContain('orca ran: bot list')
      expect(emit).not.toHaveBeenCalled()
    }, 150_000)

    it('a tidy-up runs no tool', async () => {
      const options = guarded({ ...BYPASS, ...(await readOnly('reply-only')) })
      const said = await runReal(options, run('touch made-it'))
      expect(existsSync(join(scratch, 'made-it'))).toBe(false)
      expect(said).toMatch(/"tools":\[\]/)
      expect(said.includes(REPLY_ONLY_REFUSAL) || !said.includes('"tool_use"')).toBe(true)
    }, 150_000)
  }
)

describe.skipIf(!enabled || process.platform !== 'darwin')(
  'a guarded chat adopted after an app restart, on the real Claude Code',
  () => {
    it('is denied a force push by the app that adopted it', async () => {
      const app = await adopted({})
      expect((await app.ask('status', 'status')).chats).toMatchObject([{ guarded: true }])
      await app.ask(`say ${run('git push --force origin main')}`, 'result')
      expect(JSON.stringify(app.seen('msg'))).toContain(
        "Blocked by Orca's command guard (force-push)"
      )
    }, 200_000)

    it('is denied a force push although it was adopted before the guards started', async () => {
      const app = await adopted({ startGuards: false })
      expect((await app.ask('status', 'status')).chats).toMatchObject([{ guarded: false }])
      app.send(`say ${run('git push --force origin main')}`)
      await vi.waitFor(() => expect(JSON.stringify(app.seen('msg'))).toContain('--force'), {
        timeout: 60_000
      })
      app.send('start')
      await app.next('result')
      expect(JSON.stringify(app.seen('msg'))).toContain(
        "Blocked by Orca's command guard (force-push)"
      )
      expect((await app.ask('status', 'status')).chats).toMatchObject([{ guarded: true }])
    }, 200_000)

    it('a look-around stays read-only', async () => {
      const app = await adopted({ readOnly: true })
      await app.ask(`say ${run('touch made-it')}`, 'result')
      expect(JSON.stringify(app.seen('msg'))).toMatch(
        /Looking around can only read.*Suggest this as a next step instead\./
      )
      expect(existsSync(join(scratch, 'made-it'))).toBe(false)
    }, 200_000)

    it('a call the restart cut off does not run', async () => {
      const command = 'git push --force origin main || touch made-it'
      const app = await adopted({}, { hang: run(command) })
      await app.next('result')
      expect(existsSync(join(scratch, 'made-it'))).toBe(false)
      expect(JSON.stringify(app.seen('msg'))).toMatch(/hook error/)
    }, 200_000)
  }
)
