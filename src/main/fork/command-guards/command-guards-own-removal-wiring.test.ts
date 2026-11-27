// BAD-892, through the real wiring: the guard's hook entry point (`forkCommandGuardAnswer`) decides
// on a real `orca worktree rm` command line, against a real temporary git repo and worktrees, and
// the answer and the audit line come out of the real code. The command is read, never run.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCommandGuardAudit } from './command-guards-audit'
import {
  forkCommandGuardAnswer,
  startForkCommandGuards,
  stopForkCommandGuards
} from './command-guards-live'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
import {
  addTestWorktree,
  makeOwnershipRuntime,
  makeTestRepo,
  mergeIntoMain,
  TEST_BOTS,
  type TestOwnership,
  type TestRepo
} from './command-guards-own-removal.test-fixture'

let repo: TestRepo
let home: ReturnType<typeof addTestWorktree>
let target: ReturnType<typeof addTestWorktree>
let settings: Record<string, unknown>

function start(state: TestOwnership): void {
  const { runtime } = makeOwnershipRuntime(repo, state)
  startForkCommandGuards({
    requireStore: () => ({
      getSettings: () => settings,
      getRepos: () => [],
      getBots: () => TEST_BOTS
    }),
    ...runtime
  })
}

beforeEach(() => {
  repo = makeTestRepo()
  home = addTestWorktree(repo, 'home')
  target = addTestWorktree(repo, 'feature-one')
  settings = {}
  // The worktree ids here are `repo1::<path>`: the terminal hook finds the folder from the path.
  installForkWorkspaceFolders(null)
})

afterEach(() => {
  stopForkCommandGuards()
  rmSync(dirname(repo.main), { recursive: true, force: true })
})

const ask = (command: string, paneKey = 'tab:1'): Promise<string | null> =>
  forkCommandGuardAnswer(
    'claude',
    { payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } },
    { paneKey, worktreeId: home.id, hookEventName: 'PreToolUse' },
    true
  )

const bots = (): TestOwnership => ({
  psBot: { [home.id]: 'Pixie', [target.id]: 'Pixie' },
  paneOf: { 'tab:1': 'bot-pixie', 'tab:2': 'bot-gizmo' }
})

const remove = (flags = ''): string => `orca worktree rm --worktree id:${target.id} ${flags}`.trim()
const message = (answer: string | null): string =>
  JSON.parse(answer ?? '{}').hookSpecificOutput?.permissionDecisionReason ?? ''

describe('a bot removing its own workspace, through the guard hook', () => {
  it('lets an owned, idle, clean workspace through and audits the allow', async () => {
    start(bots())
    const before = listCommandGuardAudit(500).length
    expect(await ask(remove('--json'))).toBeNull()
    expect(existsSync(target.path)).toBe(true)
    expect(listCommandGuardAudit(500)).toHaveLength(before + 1)
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      outcome: 'allowed',
      rule: 'remove-worktree',
      removal: {
        bot: 'Pixie',
        workspace: target.id,
        branch: 'feature-one',
        branchDeleted: false
      }
    })
    expect(listCommandGuardAudit(1)[0].reason).toContain('bot Pixie removed its own workspace')
  })

  it('names the failed condition when it refuses, and audits the refusal', async () => {
    start({ ...bots(), agents: { [target.id]: 1 } })
    const answer = await ask(remove())
    expect(JSON.parse(answer ?? '{}').hookSpecificOutput.permissionDecision).toBe('deny')
    expect(message(answer)).toContain('agent-running')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({ rule: 'remove-worktree' })
    expect(listCommandGuardAudit(1)[0].outcome).toBeUndefined()
  })

  it('refuses a dirty tree, another bot, and an agent with no bot', async () => {
    start(bots())
    writeFileSync(`${target.path}/scratch.txt`, 'x\n')
    expect(message(await ask(remove()))).toContain('uncommitted-changes')
    rmSync(`${target.path}/scratch.txt`)
    expect(await ask(remove())).toBeNull()
    expect(message(await ask(remove(), 'tab:2'))).toContain('target-not-owned')
    start({ psBot: { [target.id]: 'Pixie' } })
    expect(message(await ask(remove(), 'tab:9'))).toContain('caller-has-no-bot')
  })

  it('checks the branch with --delete-branch, and records that it was deleted', async () => {
    start(bots())
    expect(message(await ask(remove('--delete-branch')))).toContain('branch-not-merged')
    mergeIntoMain(repo, 'feature-one')
    expect(await ask(remove('--delete-branch'))).toBeNull()
    expect(listCommandGuardAudit(1)[0].removal).toMatchObject({ branchDeleted: true })
  })

  it('keeps every other removal blocked', async () => {
    start(bots())
    for (const command of [
      remove('--force'),
      `git worktree remove ${target.path}`,
      `orca worktree rm --worktree id:repo1::/nowhere`
    ]) {
      expect(
        JSON.parse((await ask(command)) ?? '{}').hookSpecificOutput?.permissionDecision,
        command
      ).toBe('deny')
    }
  })

  it('is a setting: off, every removal is blocked as before', async () => {
    settings = { forkCommandGuardBotOwnWorktreeRemoval: false }
    start(bots())
    const answer = await ask(remove())
    expect(JSON.parse(answer ?? '{}').hookSpecificOutput.permissionDecision).toBe('deny')
    expect(message(answer)).not.toContain('Not allowed for a bot')
  })
})
