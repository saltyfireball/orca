import { defineFixture } from '../../component-fixtures/component-fixture'
import { useAppStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { NewTabAgentMenuModel } from '@/components/agent/launch-menu/new-tab-agent-menu-model'
import { ForkAgentProfileMenuItems } from './ForkAgentProfileMenuItems'
import { ForkAgentProfileAutomationField } from './ForkAgentProfileAutomationField'

const profiles = [
  {
    name: 'reviewer',
    agent: 'claude',
    model: 'claude-sonnet-5-5',
    permissionMode: 'full-access',
    account: 'team@example.com',
    preamble: 'You review code.',
    whenToUse: 'Second opinion on a finished change'
  },
  { name: 'lookup', agent: 'codex', permissionMode: 'ask', whenToUse: 'Quick read-only questions' },
  {
    name: 'imported-helper',
    agent: 'claude',
    preamble: 'Imported text',
    imported: { path: '/repo/.claude/agents/helper.md' }
  }
]
const settings = { forkAgentProfiles: profiles }
const withProfiles = (): void =>
  useAppStore.setState((state) => ({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fixture profiles in the stored shape; the menu normalizes them.
    settings: { ...state.settings, forkAgentProfiles: profiles } as never
  }))

const model: NewTabAgentMenuModel = {
  state: 'settled',
  rows: [
    { kind: 'chat', agent: 'claude' },
    { kind: 'cli', agent: 'codex', chat: true }
  ],
  detection: {
    detectedIds: ['claude', 'codex'],
    isLoading: false,
    detectionFailed: false,
    isRefreshing: false,
    needsServerUpdate: false,
    refresh: async () => []
  }
}

export const newTabMenu = defineFixture({
  width: 380,
  setup: withProfiles,
  render: () => (
    <div className="h-[340px] bg-background p-3">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>New</DropdownMenuTrigger>
        <DropdownMenuContent align="start" style={{ width: 340 }}>
          <DropdownMenuItem variant="create">Claude</DropdownMenuItem>
          <DropdownMenuItem variant="create">Codex</DropdownMenuItem>
          <ForkAgentProfileMenuItems model={model} onLaunch={() => true} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})

export const automationField = defineFixture({
  width: 340,
  render: () => (
    <div className="h-[300px] bg-muted/20 p-4">
      <ForkAgentProfileAutomationField
        settings={settings}
        modern
        surface="chat"
        onDraftChange={() => undefined}
      />
    </div>
  ),
  interact: async (frame) => {
    const trigger = frame.querySelector<HTMLButtonElement>('button[aria-label="Profile"]')
    trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  }
})
