// BAD-892: a bot's own worktree removal, judged against a real temporary git repo. Only the store
// (who owns what, which agents are open) is stood in.
import { rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { judgeOwnWorktreeRemoval, type OwnRemovalCaller } from './command-guards-own-removal'
import {
  addTestWorktree,
  git,
  makeOwnershipRuntime,
  makeTestRepo,
  mergeIntoMain,
  type TestOwnership,
  type TestRepo
} from './command-guards-own-removal.test-fixture'

let repo: TestRepo
let home: ReturnType<typeof addTestWorktree>
let target: ReturnType<typeof addTestWorktree>

beforeEach(() => {
  repo = makeTestRepo()
  home = addTestWorktree(repo, 'home')
  target = addTestWorktree(repo, 'feature-one')
})

afterEach(() => {
  rmSync(dirname(repo.main), { recursive: true, force: true })
})

const owned = (): TestOwnership => ({
  psBot: { [home.id]: 'Pixie', [target.id]: 'Pixie' },
  paneOf: { 'tab:1': 'bot-pixie' }
})

const caller = (): OwnRemovalCaller => ({
  workspaceId: home.id,
  root: home.path,
  paneKey: 'tab:1'
})

const judge = (state: TestOwnership, deleteBranch = false, who = caller()) =>
  judgeOwnWorktreeRemoval(
    makeOwnershipRuntime(repo, state).host,
    who,
    { selector: `id:${target.id}`, deleteBranch },
    []
  )

const failed = async (...args: Parameters<typeof judge>): Promise<string | null> => {
  const { decision } = await judge(...args)
  return decision.allowed ? null : decision.failed
}

describe('judgeOwnWorktreeRemoval, against real git', () => {
  it('allows an owned, idle, clean workspace', async () => {
    const outcome = await judge(owned())
    expect(outcome.decision).toMatchObject({ allowed: true, bot: 'Pixie' })
    expect(outcome.workspace).toEqual({ id: target.id, branch: 'feature-one' })
  })

  it('allows a workspace a worker the bot started created', async () => {
    const state: TestOwnership = {
      ...owned(),
      psBot: { [home.id]: 'Pixie' },
      workerOf: { [target.id]: 'bot-pixie' }
    }
    expect(await failed(state)).toBeNull()
  })

  it('refuses another bot, a workspace nobody owns, and an agent with no bot', async () => {
    expect(await failed({ ...owned(), psBot: { [home.id]: 'Pixie', [target.id]: 'Gizmo' } })).toBe(
      'target-not-owned'
    )
    expect(await failed({ ...owned(), psBot: { [home.id]: 'Pixie' } })).toBe('target-not-owned')
    expect(await failed({ psBot: { [target.id]: 'Pixie' } })).toBe('caller-has-no-bot')
  })

  it('refuses when an agent is open in the workspace, or the caller is inside it', async () => {
    expect(await failed({ ...owned(), agents: { [target.id]: 1 } })).toBe('agent-running')
    expect(
      await failed(owned(), false, { workspaceId: target.id, root: target.path, paneKey: 'tab:1' })
    ).toBe('caller-inside-target')
    expect(await failed(owned(), false, { ...caller(), root: `${target.path}/sub` })).toBe(
      'caller-inside-target'
    )
  })

  it('refuses a tracked change and an untracked file, and allows once they are gone', async () => {
    writeFileSync(`${target.path}/feature-one.txt`, 'edited\n')
    expect(await failed(owned())).toBe('uncommitted-changes')
    git(target.path, 'checkout', '--', '.')
    expect(await failed(owned())).toBeNull()
    writeFileSync(`${target.path}/scratch.txt`, 'new\n')
    expect(await failed(owned())).toBe('uncommitted-changes')
    rmSync(`${target.path}/scratch.txt`)
    expect(await failed(owned())).toBeNull()
  })

  it('checks the branch only with --delete-branch', async () => {
    expect(await failed(owned(), false)).toBeNull()
    expect(await failed(owned(), true)).toBe('branch-not-merged')
    mergeIntoMain(repo, 'feature-one')
    expect(await failed(owned(), true)).toBeNull()
  })

  it('never calls the default branch merged', async () => {
    mergeIntoMain(repo, 'feature-one')
    const { decision } = await judgeOwnWorktreeRemoval(
      makeOwnershipRuntime(repo, owned()).host,
      caller(),
      { selector: `id:${target.id}`, deleteBranch: true },
      ['feature-one']
    )
    expect(decision).toMatchObject({ allowed: false, failed: 'branch-not-merged' })
  })

  it('refuses a selector Orca cannot resolve and the main checkout', async () => {
    const host = makeOwnershipRuntime(repo, owned()).host
    for (const selector of ['id:repo1::/nowhere', 'name:anything', `path:${repo.main}`]) {
      const { decision } = await judgeOwnWorktreeRemoval(
        host,
        caller(),
        { selector, deleteBranch: false },
        []
      )
      expect(decision, selector).toMatchObject({ allowed: false, failed: 'target-unresolved' })
    }
  })

  it('refuses when the check does not finish in time', async () => {
    const { host } = makeOwnershipRuntime(repo, owned())
    const slow = { ...host, psRows: () => new Promise<never>(() => undefined) }
    const { decision } = await judgeOwnWorktreeRemoval(
      slow,
      caller(),
      { selector: `id:${target.id}`, deleteBranch: false },
      [],
      30
    )
    expect(decision).toMatchObject({ allowed: false, failed: 'timed-out' })
  })
})
