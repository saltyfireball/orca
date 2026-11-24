// BAD-686: an agent's guard line in `orca agent list|show`, one per case, and that it agrees with
// `orca command-guards status` on the same host. Real status, chat registry and folder lookup.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversationRow } from '../../../shared/agent-conversations/agent-conversation-contracts'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../shared/agent-session/view/structured-agent-session-projection'
import { commandGuardAgentLine } from '../../../shared/fork/command-guards-agent-line'
import { sleeperChatSessionId } from '../../../shared/fork/sleepers-ps-sources'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
import {
  noteCommandGuardChatAdopted,
  noteCommandGuardChatInitialized,
  resetCommandGuardChats
} from './command-guards-chat-registry'
import { forkChatGuardOptions } from './command-guards-native-chat'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkCommandGuardStatus, type ForkCommandGuardLiveAgent } from './command-guards-status'
import { forkAgentRowsWithCommandGuards } from './command-guards-agent-rows'

const places = vi.hoisted(() => ({ rows: [] as AgentConversationRow[] }))
vi.mock('../../runtime/agent-conversations/agent-conversation-address', () => ({
  resolveAgentConversation: async () => ({ orcaSessionId: 'orca-1', kind: 'terminal' })
}))
vi.mock('../../runtime/agent-conversations/agent-conversation-list', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentConversationPlaces: async () => places.rows
}))
const { AGENT_CONVERSATION_METHODS } =
  await import('../../runtime/rpc/methods/agent-conversations/agent-conversation-methods')

let root: string
let settings: Record<string, unknown>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guard-rows-'))
  settings = {}
  startForkCommandGuards({
    requireStore: () => ({ getSettings: () => settings, getRepos: () => [] })
  })
  const folders: Record<string, Partial<FolderWorkspace>> = {
    notes: { id: 'notes', folderPath: root, projectGroupId: 'group-1' }
  }
  installForkWorkspaceFolders({
    requireStore: () => ({
      getFolderWorkspace: (id) => folders[id] as FolderWorkspace | undefined,
      getProjectGroups: () => []
    })
  })
  resetCommandGuardChats()
})

afterEach(() => {
  setStructuredAgentSessionHost(null)
  installForkWorkspaceFolders(null)
  resetCommandGuardChats()
  rmSync(root, { recursive: true, force: true })
})

/** The chats the host says are running; command-guards-unknown-chat.test.ts has the real host. */
function runChats(...sessionIds: string[]): void {
  const host = {
    loadedSessionIds: () => sessionIds,
    deps: { store: { getRecord: () => ({ provider: 'claude' }) } }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the guards read only these two.
  setStructuredAgentSessionHost(host as unknown as StructuredAgentSessionHost)
}

function row(agent: string, paneKey: string, worktreeId = `repo1::${root}`): AgentConversationRow {
  return {
    orcaSessionId: null,
    kind: sleeperChatSessionId(paneKey) ? 'chat' : 'terminal',
    agent,
    state: 'working',
    worktreeId,
    workspace: 'demo',
    paneKey,
    title: null,
    lastAssistantMessage: null,
    updatedAt: 1
  }
}

const chatPane = (session: string): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(session), session)

const live = (rows: AgentConversationRow[]): ForkCommandGuardLiveAgent[] =>
  rows.map(({ worktreeId, paneKey, agent }) => ({ worktreeId, paneKey, agentType: agent ?? '' }))

const lineOf = (subject: AgentConversationRow, liveRows = [subject]) =>
  forkAgentRowsWithCommandGuards([subject], live(liveRows))[0].commandGuard

describe('agent guard line', () => {
  it('a Codex terminal is unguarded with the reason', () => {
    expect(lineOf(row('codex', 'tab-c:leaf-1'))).toEqual({
      guarded: false,
      note: 'unguarded: its hook cannot block a call or Orca does not read its reply'
    })
  })

  it('an OpenCode chat is unguarded with the reason', () => {
    const line = lineOf(row('opencode', chatPane('sess-o')))
    expect(line).toEqual({
      guarded: false,
      note: 'unguarded: its hook cannot block a call or Orca does not read its reply'
    })
  })

  it('a chat is unguarded while its host runs no guards, and guarded once they start', () => {
    stopForkCommandGuards()
    forkChatGuardOptions({}, 'sess-early', root)
    expect(lineOf(row('claude', chatPane('sess-early')))).toEqual({
      guarded: false,
      note: 'unguarded: the command guards are not running on its host'
    })
    startForkCommandGuards({
      requireStore: () => ({ getSettings: () => settings, getRepos: () => [] })
    })
    expect(lineOf(row('claude', chatPane('sess-early')))?.guarded).toBe(true)
  })

  it('a chat carried over a restart is unguarded until Claude Code confirms its hook', () => {
    forkChatGuardOptions({}, 'sess-bare', root)
    noteCommandGuardChatAdopted('sess-bare')
    forkChatGuardOptions({}, 'sess-held', root)
    expect(lineOf(row('claude', chatPane('sess-bare')))).toEqual({
      guarded: false,
      note: 'unguarded: this chat was carried over an app restart and Claude Code has not confirmed its guard hook yet'
    })
    for (const reply of [{}, { hooks_applied: false }, null]) {
      noteCommandGuardChatInitialized('sess-bare', reply)
      expect(lineOf(row('claude', chatPane('sess-bare')))?.guarded).toBe(false)
    }
    expect(lineOf(row('claude', chatPane('sess-held')))).toEqual({
      guarded: true,
      note: 'Claude native chat: PreToolUse hook answered inside Orca for each chat'
    })
    noteCommandGuardChatInitialized('sess-bare', { hooks_applied: true })
    expect(lineOf(row('claude', chatPane('sess-bare')))?.guarded).toBe(true)
  })

  it('a chat not known to this app, or of a host that does not say, is unguarded', () => {
    expect(lineOf(row('claude', chatPane('sess-nobody')))).toEqual({
      guarded: false,
      note: 'unguarded: this chat is not known to this app: it has not started it, or lost track of it'
    })
    const { chats: _chats, ...older } = forkCommandGuardStatus([])
    const { surfaces: _surfaces, ...oldest } = older
    for (const status of [older, oldest]) {
      expect(commandGuardAgentLine(status, row('claude', chatPane('sess-nobody')))).toEqual({
        guarded: false,
        note: 'unguarded: its host does not say which of its chats have the guard'
      })
    }
    expect(commandGuardAgentLine(oldest, row('claude', 'tab-h:leaf-1'))?.guarded).toBe(true)
  })

  it('a Claude terminal in a workspace with no folder on this host is unguarded until it is gone', () => {
    const stray = row('claude', 'tab-s:leaf-1', 'folder:gone')
    const here = row('claude', 'tab-h:leaf-1', 'folder:notes')
    expect(lineOf(stray)?.guarded).toBe(false)
    expect(lineOf(stray)?.note).toMatch(/^unguarded: this workspace has no folder on its host/)
    expect(lineOf(here, [here, stray])?.guarded).toBe(true)
    // The stray agent closed: the workspace drops out of the status and no row stays unguarded.
    expect(forkCommandGuardStatus(live([here])).unguardedWorkspaces).toEqual([])
    expect(
      forkCommandGuardStatus(live([here])).surfaces?.find((s) => s.surface === 'terminal')?.guarded
    ).toBe(true)
  })

  it('shows nothing when command guards are off by setting', () => {
    settings = { forkCommandGuards: false }
    expect(lineOf(row('codex', 'tab-c:leaf-1'))).toBeUndefined()
  })

  it('says unguarded wherever the status does, and guarded only where the status does', () => {
    forkChatGuardOptions({}, 'sess-bare', root)
    noteCommandGuardChatAdopted('sess-bare')
    runChats('sess-bare')
    const rows = [
      row('codex', 'tab-c:leaf-1'),
      row('opencode', chatPane('sess-o')),
      row('claude', chatPane('sess-bare')),
      row('claude', 'tab-s:leaf-1', 'folder:gone'),
      row('claude', 'tab-h:leaf-1', 'folder:notes')
    ]
    const lines = forkAgentRowsWithCommandGuards(rows, live(rows))
    const status = forkCommandGuardStatus(live(rows))
    const surface = (name: string) => status.surfaces?.find((s) => s.surface === name)
    for (const { agent, paneKey, worktreeId, commandGuard } of lines) {
      if (agent !== 'claude') {
        const listed = status.agents.find((entry) => entry.agent === agent)
        expect(commandGuard).toEqual({ guarded: listed?.guarded, note: listed?.note })
      } else if (paneKey === chatPane('sess-bare')) {
        expect(commandGuard?.guarded).toBe(false)
        expect(surface('native-chat')?.guarded).toBe(false)
        expect(status.chats).toContainEqual({
          sessionId: 'sess-bare',
          surface: 'native-chat',
          guarded: false,
          reason: expect.stringContaining('app restart')
        })
      } else if (worktreeId === 'folder:gone') {
        expect(commandGuard?.guarded).toBe(false)
        expect(surface('terminal')?.guarded).toBe(false)
        expect(status.unguardedWorkspaces).toContain('folder:gone')
      } else {
        expect(commandGuard?.guarded).toBe(true)
        expect(surface('terminal')?.proof).not.toBeNull()
      }
    }
  })

  it('a Claude terminal on a Windows host is unguarded in both', () => {
    const status = forkCommandGuardStatus([], 'win32')
    expect(status.surfaces?.find((s) => s.surface === 'terminal')).toMatchObject({
      guarded: false,
      proof: null
    })
  })
})

describe('agent.list and agent.show rows', () => {
  const method = (name: string) => {
    const found = AGENT_CONVERSATION_METHODS.find((entry) => entry.name === name)
    if (!found) {
      throw new Error(name)
    }
    return found.handler as (params: unknown, ctx: unknown) => Promise<unknown>
  }

  it('agent.list rows carry the guard line', async () => {
    const runtime = {
      getWorktreePs: async () => ({
        worktrees: [
          {
            worktreeId: `repo1::${root}`,
            displayName: 'demo',
            agents: [
              {
                paneKey: 'tab-c:leaf-1',
                agentType: 'codex',
                state: 'working',
                lastAssistantMessage: null,
                updatedAt: 1,
                taskTitle: null,
                displayName: null
              }
            ]
          }
        ],
        truncated: false
      })
    }
    const result = (await method('agent.list')({}, { runtime })) as {
      agents: AgentConversationRow[]
    }
    expect(result.agents[0].commandGuard?.guarded).toBe(false)
  })

  it('agent.show places carry the guard line', async () => {
    places.rows = [row('codex', 'tab-c:leaf-1')]
    const result = (await method('agent.show')({ id: 'orca-1' }, { runtime: {} })) as {
      places: AgentConversationRow[]
    }
    expect(result.places[0].commandGuard?.guarded).toBe(false)
  })
})
