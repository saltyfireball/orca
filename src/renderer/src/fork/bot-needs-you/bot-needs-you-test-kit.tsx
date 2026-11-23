// The sidebar row beside the bot's panel, for the fixtures and the test of their shared count
// (FORK.md "Needs you list", BAD-795). Made-up bot and data; every host read is stubbed.
import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { makeFolderWorkspace } from '@/store/folder-workspaces/folder-workspace.test-fixture'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { publishBots } from '@/lib/bot-catalog-snapshot'
import { ConfirmationDialogProvider } from '@/components/dismiss/confirmation/confirmation-dialog'
import { BotRow } from '@/components/bots/BotRow'
import BotActivityPanel from '@/components/bots/BotActivityPanel'
import type { Bot } from '../../../../shared/bot-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { BotItem } from '../../../../shared/bots/bot-items'
import { makeTestBotItem } from '../../../../shared/bots/bot-item.test-fixture'
import { structuredAgentSessionStatusPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import {
  botPanelPage,
  fixtureCos,
  fixtureWorker,
  stubBotPanel
} from '../../component-fixtures/fixture-bot-panel'
import { ForkBotNeedsYouHost } from './ForkBotNeedsYouHost'

const now = Date.now()
export const gardener: Bot = { ...fixtureCos, name: 'Gardener' }
const HOME = folderWorkspaceKey(gardener.folderWorkspaceId)

/** What waits in a scene. A background run is as its host publishes it: at work, whatever it asks. */
export type BotNeedsYouScene = {
  item?: boolean
  waitingChat?: boolean
  backgroundRun?: boolean
  /** A worker only the bot's own host knows of, stopped on an approval. */
  worker?: boolean
}

function chat(
  sessionId: string,
  state: AgentStatusEntry['state'],
  prompt: string
): AgentStatusEntry {
  return {
    paneKey: structuredAgentSessionStatusPaneKey(sessionId),
    worktreeId: HOME,
    agentType: 'claude',
    state,
    prompt,
    updatedAt: now - 10_000,
    stateStartedAt: now - 10_000,
    stateHistory: []
  }
}

const ITEM: BotItem = makeTestBotItem(7, {
  title: 'Pick the seed list',
  status: 'needs_you',
  question: { eventId: 'e7', text: 'Beans or peas?' },
  lastActivityAt: now - 60_000
})

export function sceneStore(scene: BotNeedsYouScene, selected: boolean): Partial<AppState> {
  const entries = [
    ...(scene.waitingChat ? [chat('chat-greenhouse', 'blocked', 'Plan the greenhouse')] : []),
    ...(scene.backgroundRun ? [chat('look-1', 'working', 'Look around')] : [])
  ]
  return {
    ...botPanelPage(true, null),
    ...(selected ? {} : { activeWorktreeId: null, activeWorkspaceKey: null }),
    agentStatusByPaneKey: acceptedAgentStatuses(entries.map((entry) => [entry.paneKey, entry]))
  }
}

export function setupScene(scene: BotNeedsYouScene): void {
  const items = scene.item ? [ITEM] : []
  stubBotPanel(
    {
      workers: scene.worker ? [fixtureWorker('d-hedge', 'Trim the hedge', 'permission')] : [],
      inProgress: [],
      completed: [],
      automations: [],
      waits: []
    },
    gardener,
    [],
    items
  )()
  const { runtime } = window.api
  Reflect.set(window.api, 'runtime', {
    ...runtime,
    call: async (request: Parameters<typeof runtime.call>[0]) =>
      request.method === 'pairedServerAsks.list'
        ? { ok: true, result: { cards: [] } }
        : runtime.call(request)
  })
  publishBots([gardener], {
    threadReplies: false,
    webhooks: undefined,
    waits: {},
    needsYou: { [gardener.id]: items.length },
    needsYouAt: now
  })
}

const home = makeFolderWorkspace({
  id: gardener.folderWorkspaceId,
  name: gardener.name,
  folderPath: '/bots/gardener'
})

/** Puts the bot on screen, as opening its row does. */
export function selectGardener(): void {
  useAppStore.setState({ activeWorktreeId: HOME, activeWorkspaceKey: HOME })
}

/** The row alone, or with the bot on screen and its panel beside it. */
export function BotRowAndPanel(): React.JSX.Element {
  const open = useAppStore((s) => s.activeWorktreeId === HOME)
  return (
    <ConfirmationDialogProvider>
      <ForkBotNeedsYouHost />
      <div className="flex items-start gap-2">
        <div
          data-testid="row"
          className="w-72 shrink-0 bg-worktree-sidebar p-2 text-worktree-sidebar-foreground"
        >
          <BotRow bot={gardener} home={home} isActive={open} onOpen={() => {}} />
        </div>
        <div data-testid="panel" className="flex w-80 flex-col bg-sidebar">
          {open ? <BotActivityPanel /> : null}
        </div>
      </div>
    </ConfirmationDialogProvider>
  )
}
