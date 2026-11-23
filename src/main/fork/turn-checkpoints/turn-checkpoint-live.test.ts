// Turn checkpoints in folder workspaces (`folder:<id>` owners), through the live status feed and
// the RPC, over real git: capture per turn, restore, the busy refusal across workspaces sharing a
// directory, a folder on another host, and nested repositories in a multi-repo folder.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import type { ForkTurnCheckpointsRestoreResult } from '../../../shared/fork/turn-checkpoints'
import { structuredAgentSessionStatusPaneKey } from '../../../shared/agent-session/view/structured-agent-session-tab'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { RpcContext } from '../../runtime/rpc/core'
import { FORK_TURN_CHECKPOINT_METHODS } from '../../runtime/rpc/methods/fork/fork-turn-checkpoints'
import { createLostWorkSandbox, type LostWorkSandbox } from '../lost-work/lost-work.test-fixture'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
import {
  forkTurnCheckpointService,
  installForkTurnCheckpoints,
  startForkTurnCheckpoints
} from './turn-checkpoint-live'

type StatusRow = { paneKey: string; worktreeId?: string; state: string; agentType?: string }

const hooks = vi.hoisted(() => ({
  listener: null as ((event: EnrichedAgentHookEventPayload) => void) | null,
  rows: [] as { paneKey: string; worktreeId?: string; state: string; agentType?: string }[],
  dataRoot: ''
}))

vi.mock('../../agent-hooks/server/agent-hook-server', () => ({
  agentHookServer: {
    getStatusSnapshot: () => hooks.rows,
    subscribeEnrichedStatus: (listener: (event: EnrichedAgentHookEventPayload) => void) => {
      hooks.listener = listener
      return () => undefined
    }
  }
}))

vi.mock('../../persistence/loading-store/user-data-path', () => ({
  getCanonicalUserDataPath: () => hooks.dataRoot
}))

let sandbox: LostWorkSandbox
let folders: Record<string, Partial<FolderWorkspace>> = {}
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  sandbox = await createLostWorkSandbox()
  hooks.dataRoot = join(sandbox.root, 'data')
  // The checkpoint git runs with this process's environment; keep the user's git config out.
  for (const [key, value] of Object.entries({
    GIT_CONFIG_GLOBAL: sandbox.emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1'
  })) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }
  installForkTurnCheckpoints({ getSettings: () => ({}) })
  installForkWorkspaceFolders({
    requireStore: () => ({
      getFolderWorkspace: (id) => folders[id] as FolderWorkspace | undefined,
      getProjectGroups: () => []
    })
  })
  startForkTurnCheckpoints()
})

afterAll(async () => {
  installForkWorkspaceFolders(null)
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  await sandbox.dispose()
})

beforeEach(() => {
  hooks.rows = []
  folders = {}
})

let paneSeq = 0
function emit(paneKey: string, worktreeId: string, state: 'working' | 'done'): void {
  hooks.listener?.({
    paneKey,
    worktreeId,
    connectionId: null,
    payload: { state, agentType: 'claude', prompt: 'tidy the notes' },
    receivedAt: Date.now(),
    stateStartedAt: Date.now()
  } as unknown as EnrichedAgentHookEventPayload)
}

/** One agent turn; the folder's queue is drained after its start and its end, as a real turn's are. */
async function turn(paneKey: string, worktreeId: string, path: string, edit?: () => Promise<void>) {
  emit(paneKey, worktreeId, 'working')
  await listed(path)
  await edit?.()
  emit(paneKey, worktreeId, 'done')
  await listed(path)
}

async function folderWorkspace(id: string, extra: Partial<FolderWorkspace> = {}): Promise<string> {
  const path = join(sandbox.root, `folder-${id}`)
  await mkdir(path, { recursive: true })
  folders[id] = { id, folderPath: path, projectGroupId: 'group-1', ...extra }
  return path
}

const ctx = { runtime: { showManagedWorktree: () => Promise.reject(new Error('not a repo')) } }

function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  const method = FORK_TURN_CHECKPOINT_METHODS.find((entry) => entry.name === name)
  if (!method) {
    throw new Error(`no ${name}`)
  }
  const parsed = method.params.parse(params) as never
  return method.handler(parsed, ctx as unknown as RpcContext)
}

async function listed(path: string) {
  const service = forkTurnCheckpointService()
  if (!service) {
    throw new Error('checkpoints not installed')
  }
  return (await service.list(path)).checkpoints
}

describe('folder workspace checkpoints', () => {
  it('a terminal agent turn makes one checkpoint when files changed and none when not', async () => {
    const path = await folderWorkspace('fa')
    const pane = `tab-${++paneSeq}:1`
    await writeFile(join(path, 'notes.txt'), 'one\n')
    await turn(pane, 'folder:fa', path, () => writeFile(join(path, 'notes.txt'), 'two\n'))
    const first = await listed(path)
    expect(first.map((item) => item.kind)).toEqual(['turn', 'baseline'])
    await turn(pane, 'folder:fa', path)
    expect(await listed(path)).toHaveLength(2)
  })

  it('a native chat turn in a folder workspace is checkpointed the same way', async () => {
    const path = await folderWorkspace('fb')
    const pane = structuredAgentSessionStatusPaneKey(`session-${++paneSeq}`)
    await turn(pane, 'folder:fb', path, () => writeFile(join(path, 'draft.md'), 'hello\n'))
    expect((await listed(path)).map((item) => item.kind)).toEqual(['turn', 'baseline'])
    await turn(pane, 'folder:fb', path)
    expect(await listed(path)).toHaveLength(2)
  })

  it('restore through the RPC reverts tracked and untracked files and records a pre-restore', async () => {
    const path = await folderWorkspace('fc')
    const pane = `tab-${++paneSeq}:1`
    await writeFile(join(path, 'keep.txt'), 'original\n')
    await turn(pane, 'folder:fc', path, () => writeFile(join(path, 'keep.txt'), 'turn one\n'))
    const [target] = await listed(path)
    await turn(pane, 'folder:fc', path, async () => {
      await writeFile(join(path, 'keep.txt'), 'turn two\n')
      await writeFile(join(path, 'new.txt'), 'added later\n')
    })
    await writeFile(join(path, 'loose.txt'), 'after the last turn\n')
    const result = (await rpc('fork.turnCheckpoints.restore', {
      worktree: 'id:folder:fc',
      id: target.id
    })) as ForkTurnCheckpointsRestoreResult
    expect(await readFile(join(path, 'keep.txt'), 'utf8')).toBe('turn one\n')
    await expect(readFile(join(path, 'new.txt'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(path, 'loose.txt'), 'utf8')).rejects.toThrow()
    expect(result.preRestore?.kind).toBe('pre-restore')
    expect((await listed(path)).map((item) => item.kind)).toContain('pre-restore')
  })

  it('refuses restore while an agent of any workspace on that folder is busy', async () => {
    const path = await folderWorkspace('fd')
    folders.fe = { ...folders.fd, id: 'fe' }
    const pane = `tab-${++paneSeq}:1`
    await turn(pane, 'folder:fd', path, () => writeFile(join(path, 'a.txt'), 'a\n'))
    const [target] = await listed(path)
    const restore = () =>
      rpc('fork.turnCheckpoints.restore', { worktree: 'folder:fd', id: target.id })
    for (const busy of [
      { paneKey: 'tab-x:1', worktreeId: 'folder:fd', state: 'working', agentType: 'claude' },
      {
        paneKey: structuredAgentSessionStatusPaneKey('chat-busy'),
        worktreeId: 'folder:fd',
        state: 'blocked',
        agentType: 'codex'
      },
      { paneKey: 'tab-y:1', worktreeId: 'folder:fe', state: 'working', agentType: 'claude' },
      { paneKey: 'tab-z:1', worktreeId: `repo-1::${path}`, state: 'working', agentType: 'claude' }
    ] satisfies StatusRow[]) {
      hooks.rows = [busy]
      await expect(restore(), busy.worktreeId).rejects.toThrow(/busy|working/i)
    }
    hooks.rows = [{ paneKey: 'tab-x:1', worktreeId: 'folder:fd', state: 'done' }]
    await expect(restore()).resolves.toBeTruthy()
  })

  it('a folder workspace on an SSH host is neither checkpointed nor restored here', async () => {
    const path = await folderWorkspace('ff', { connectionId: 'ssh-target-1' })
    await turn(`tab-${++paneSeq}:1`, 'folder:ff', path, () => writeFile(join(path, 'x.txt'), 'x\n'))
    expect(await listed(path)).toHaveLength(0)
    await expect(rpc('fork.turnCheckpoints.list', { worktree: 'folder:ff' })).rejects.toThrow(
      /another host/
    )
    await expect(rpc('fork.turnCheckpoints.list', { worktree: 'folder:unknown' })).rejects.toThrow(
      /another host/
    )
  })

  it('in a multi-repo folder, nested repositories keep their own .git and contents', async () => {
    const path = await folderWorkspace('fg')
    const nested = join(path, 'service-a')
    await mkdir(nested)
    await sandbox.run(nested, 'init', '-q', '-b', 'main')
    await writeFile(join(nested, 'app.txt'), 'v1\n')
    await sandbox.run(nested, 'add', '.')
    await sandbox.run(nested, 'commit', '-q', '-m', 'one')
    await writeFile(join(path, 'top.txt'), 'top one\n')
    const pane = `tab-${++paneSeq}:1`
    await turn(pane, 'folder:fg', path, () => writeFile(join(path, 'top.txt'), 'top two\n'))
    const [target] = await listed(path)
    await turn(pane, 'folder:fg', path, async () => {
      await writeFile(join(path, 'top.txt'), 'top three\n')
      await writeFile(join(nested, 'app.txt'), 'v2\n')
      await sandbox.run(nested, 'commit', '-q', '-am', 'two')
      await writeFile(join(nested, 'wip.txt'), 'uncommitted\n')
    })
    const second = join(path, 'service-b')
    await mkdir(second)
    await sandbox.run(second, 'init', '-q', '-b', 'main')
    await writeFile(join(second, 'b.txt'), 'b\n')
    await sandbox.run(second, 'add', '.')
    await sandbox.run(second, 'commit', '-q', '-m', 'b')
    const gitFiles = async () =>
      Promise.all(
        [nested, second].flatMap((repo) =>
          ['index', 'HEAD', 'refs/heads/main'].map((file) => readFile(join(repo, '.git', file)))
        )
      )
    const before = await gitFiles()
    await rpc('fork.turnCheckpoints.restore', { worktree: 'folder:fg', id: target.id })
    expect(await readFile(join(path, 'top.txt'), 'utf8')).toBe('top two\n')
    // Nested repositories are recorded as a pointer: their files, history and .git stay as they are.
    expect(await readFile(join(nested, 'app.txt'), 'utf8')).toBe('v2\n')
    expect(await readFile(join(nested, 'wip.txt'), 'utf8')).toBe('uncommitted\n')
    expect(await readFile(join(second, 'b.txt'), 'utf8')).toBe('b\n')
    expect(await gitFiles()).toEqual(before)
  })
})
