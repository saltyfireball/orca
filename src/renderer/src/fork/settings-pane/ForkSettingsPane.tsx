// The fork's own Settings pane. Every fork setting sits here in a titled section, each feature in
// its own card, with section links on top. Each card is its feature's own component, unchanged:
// this file only decides where a setting sits. The sections and their order come from the catalog,
// which the Settings search reads too.
import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SettingsGroupHeader } from '@/components/settings/section-layout/SettingsGroup'
import { useTranslate } from '@/i18n/use-translate'
import { ForkChatSurviveSetting } from '../ForkChatSurviveSetting'
import { ForkUnattendedResumeSetting } from '../unattended-resume/ForkUnattendedResumeSetting'
import { ForkLimitResumeSetting } from '../limit-resume/ForkLimitResumeSetting'
import { ForkBoundaryCompactionSetting } from '../boundary-compaction/ForkBoundaryCompactionSetting'
import { ForkChatSleepSetting } from '../chat-sleep/ForkChatSleepSetting'
import { ForkSleepersSetting } from '../sleepers/ForkSleepersSetting'
import { ForkChatStallSetting } from '../chat-stall/ForkChatStallSetting'
import { ForkCacheColdSetting } from '../cache-cold/ForkCacheColdSetting'
import { ForkMcpProfileSetting } from '../mcp-profiles/ForkMcpProfileSetting'
import { ForkChildTallySetting } from '../agent-child-tally/ForkChildTallySetting'
import { ForkAgentStateColorSetting } from '../agent-state-color/ForkAgentStateColorSetting'
import { ForkWorkerCleanupSetting } from '../worker-cleanup/ForkWorkerCleanupSetting'
import { ForkAgentQueueSetting } from '../agent-queue/ForkAgentQueueSetting'
import { ForkLaunchDefaultsSetting } from '../launch-defaults/ForkLaunchDefaultsSetting'
import { ForkMemorySettings } from '../memory-truth/ForkMemorySettings'
import { ForkIdleRecoverySetting } from '../idle-recovery/ForkIdleRecoverySetting'
import { ForkAccountChipSetting } from '../claude-account-chip/ForkAccountChipSetting'
import { ForkUsageReportSettings } from '../usage-report/ForkUsageReportSettings'
import { ForkLostWorkSettings } from '../lost-work/ForkLostWorkSettings'
import { ForkSyncNoticeSetting } from '../sync-status/ForkSyncNoticeSetting'
import { ForkAutoPlacementSetting } from '../auto-placement/ForkAutoPlacementSetting'
import { ForkEndpointFailoverSetting } from '../endpoint-failover/ForkEndpointFailoverSetting'
import { ForkWorktreeMoveSettings } from '../worktree-move/ForkWorktreeMoveSettings'
import { ForkApfsCloneSetting } from '../apfs-clone/ForkApfsCloneSetting'
import { ForkSnoozeSetting } from '../snooze/ForkSnoozeSetting'
import { ForkDeviceApprovalSetting } from '../device-approval/ForkDeviceApprovalSetting'
import { ForkWebhooksSetting } from '../webhooks/ForkWebhooksSetting'
import { ForkServerHealthSetting } from '../server-health/ForkServerHealthSetting'
import { ForkServerHeartbeatSetting } from '../server-health/ForkServerHeartbeatSetting'
import { ForkServerUpdateSetting } from '../server-update/ForkServerUpdateSetting'
import { ForkProjectSettingsList } from './ForkProjectSettingsList'
import { ForkSettingsSectionLinks } from './ForkSettingsSectionLinks'
import { getForkSettingsSections, type ForkSettingsSectionId } from './fork-settings-pane-catalog'

type ForkSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

type ForkSettingComponent = (props: ForkSettingProps) => React.JSX.Element | null

/** The cards of each section, in the order the catalog lists their search entries. */
const SECTION_CARDS: Record<
  ForkSettingsSectionId,
  readonly (readonly [id: string, Card: ForkSettingComponent])[]
> = {
  chats: [
    ['chat-survive', ForkChatSurviveSetting],
    ['unattended-resume', ForkUnattendedResumeSetting],
    ['limit-resume', ForkLimitResumeSetting],
    ['chat-sleep', ForkChatSleepSetting],
    ['sleepers', ForkSleepersSetting],
    ['chat-stall', ForkChatStallSetting],
    ['cache-cold', ForkCacheColdSetting],
    ['boundary-compaction', ForkBoundaryCompactionSetting],
    ['mcp-profile', ForkMcpProfileSetting]
  ],
  agents: [
    ['child-tally', ForkChildTallySetting],
    ['agent-state-color', ForkAgentStateColorSetting],
    ['worker-cleanup', ForkWorkerCleanupSetting],
    ['agent-queue', ForkAgentQueueSetting],
    ['launch-defaults', ForkLaunchDefaultsSetting],
    ['memory', ForkMemorySettings],
    ['auto-placement', ForkAutoPlacementSetting]
  ],
  'idle-recovery': [['idle-recovery', ForkIdleRecoverySetting]],
  usage: [
    ['account-chip', ForkAccountChipSetting],
    ['usage-report', ForkUsageReportSettings]
  ],
  projects: [
    ['lost-work', ForkLostWorkSettings],
    ['worktree-move', ForkWorktreeMoveSettings],
    ['apfs-clone', ForkApfsCloneSetting],
    ['snooze', ForkSnoozeSetting],
    ['project-settings-list', ForkProjectSettingsList]
  ],
  remote: [
    ['endpoint-failover', ForkEndpointFailoverSetting],
    ['server-health', ForkServerHealthSetting],
    ['server-heartbeat', ForkServerHeartbeatSetting],
    ['device-approval', ForkDeviceApprovalSetting],
    ['webhooks', ForkWebhooksSetting],
    ['server-update', ForkServerUpdateSetting]
  ],
  sync: [['sync-notice', ForkSyncNoticeSetting]]
}

/** One feature's settings. The markers are what a Settings search jump lands on and tints. */
function ForkSettingsCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div data-settings-group="">
      <div
        data-settings-group-card=""
        className="rounded-xl border border-border bg-card/50 px-5 py-4 shadow-xs"
      >
        {children}
      </div>
    </div>
  )
}

export function ForkSettingsPane(props: ForkSettingProps): React.JSX.Element {
  const t = useTranslate()
  const sections = getForkSettingsSections(t)
  return (
    <div className="space-y-8" data-fork-settings-pane="">
      <ForkSettingsSectionLinks sections={sections} />
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.anchorId}
          data-settings-group=""
          data-fork-settings-section={section.id}
          className="scroll-mt-14 space-y-3"
        >
          <SettingsGroupHeader title={section.title} description={section.description} />
          {SECTION_CARDS[section.id].map(([id, Card]) => (
            <ForkSettingsCard key={id}>
              <Card {...props} />
            </ForkSettingsCard>
          ))}
        </section>
      ))}
    </div>
  )
}
