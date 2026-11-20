import { defineFixture } from '../../component-fixtures/component-fixture'
import { publishBots } from '@/lib/bot-catalog-snapshot'
import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { makeFolderWorkspace } from '@/store/folder-workspaces/folder-workspace.test-fixture'
import { useAppStore } from '@/store'
import { ConfirmationDialogProvider } from '@/components/dismiss/confirmation/confirmation-dialog'
import { BotRow } from '@/components/bots/BotRow'
import { structuredAgentSessionStatusPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { Bot } from '../../../../shared/bot-types'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'

const now = Date.now()

function bot(id: string, name: string, paused = false): Bot {
  return {
    id,
    name,
    hostId: 'local',
    folder: id,
    folderWorkspaceId: `fw-${id}`,
    agent: 'claude',
    avatar: null,
    paused,
    notifications: { needsPermission: true, taskComplete: true, couldNotFinish: true },
    members: [],
    slack: null,
    linear: null,
    github: null,
    chatSessionId: `chat-${id}`,
    createdAt: 1,
    updatedAt: 1
  }
}

const idle = bot('idle', 'Idle bot')
const asking = bot('asking', 'Needs you bot')
const working = bot('working', 'Working bot')
const tinted = bot('tinted', 'Colored bot')
const paused = bot('paused', 'Paused bot', true)
const bots = [idle, asking, working, tinted, paused]

function entry(owner: Bot, state: AgentStatusEntry['state']): AgentStatusEntry {
  return {
    paneKey: structuredAgentSessionStatusPaneKey(`chat-${owner.id}`),
    worktreeId: folderWorkspaceKey(owner.folderWorkspaceId),
    agentType: 'claude',
    state,
    prompt: 'Delete the stale branches?',
    updatedAt: now - 10_000,
    stateStartedAt: now - 10_000,
    stateHistory: []
  }
}

export const botRowBadges = defineFixture({
  width: 320,
  store: {
    agentStatusByPaneKey: acceptedAgentStatuses(
      [entry(asking, 'blocked'), entry(working, 'working'), entry(tinted, 'working')].map((e) => [
        e.paneKey,
        e
      ])
    )
  },
  setup: () => {
    publishBots(bots, { threadReplies: false, webhooks: undefined, waits: {} })
    useAppStore.setState((state) => ({
      settings: state.settings && {
        ...state.settings,
        forkBotRowColors: { 'local/tinted': '#14b8a6', 'local/idle': '#a855f7' }
      }
    }))
  },
  render: () => (
    <ConfirmationDialogProvider>
      <div className="flex flex-col gap-1 bg-worktree-sidebar p-2 text-worktree-sidebar-foreground">
        {bots.map((owner) => (
          <BotRow
            key={owner.id}
            bot={owner}
            home={makeFolderWorkspace({
              id: owner.folderWorkspaceId,
              name: owner.name,
              folderPath: `/bots/${owner.folder}`
            })}
            isActive={false}
            onOpen={() => {}}
          />
        ))}
      </div>
    </ConfirmationDialogProvider>
  )
})
