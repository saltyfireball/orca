// The fork's own Settings pane. Every fork setting sits here in a titled section, each feature in
// its own card, with section links on top. Each card is its feature's own component, unchanged:
// this file only decides where a setting sits. The sections and their order come from the catalog,
// which the Settings search reads too.
import type React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { SettingsGroupHeader } from '@/components/settings/section-layout/SettingsGroup'
import { useTranslate } from '@/i18n/use-translate'
import { ForkChatSurviveSetting } from '../ForkChatSurviveSetting'
import { ForkUnattendedResumeSetting } from '../unattended-resume/ForkUnattendedResumeSetting'
import { ForkLimitResumeSetting } from '../limit-resume/ForkLimitResumeSetting'
import { ForkAgentGuardsSetting } from '../agent-guards/ForkAgentGuardsSetting'
import { ForkChatHandoffSetting } from '../chat-handoff/ForkChatHandoffSetting'
import { ForkBoundaryCompactionSetting } from '../boundary-compaction/ForkBoundaryCompactionSetting'
import { ForkChatSleepSetting } from '../chat-sleep/ForkChatSleepSetting'
import { ForkSleepersSetting } from '../sleepers/ForkSleepersSetting'
import { ForkChatStallSetting } from '../chat-stall/ForkChatStallSetting'
import { ForkCacheColdSetting } from '../cache-cold/ForkCacheColdSetting'
import { ForkMcpProfileSetting } from '../mcp-profiles/ForkMcpProfileSetting'
import { ForkVisualFallbackSetting } from '../visual-image/ForkVisualFallbackSetting'
import { ForkChildTallySetting } from '../agent-child-tally/ForkChildTallySetting'
import { ForkRowStatusSetting } from '../row-status/ForkRowStatusSetting'
import { ForkAgentStateColorSetting } from '../agent-state-color/ForkAgentStateColorSetting'
import { ForkWorkerCleanupSetting } from '../worker-cleanup/ForkWorkerCleanupSetting'
import { ForkAgentQueueSetting } from '../agent-queue/ForkAgentQueueSetting'
import { ForkLaunchDefaultsSetting } from '../launch-defaults/ForkLaunchDefaultsSetting'
import { ForkMemorySettings } from '../memory-truth/ForkMemorySettings'
import { ForkIdleRecoverySetting } from '../idle-recovery/ForkIdleRecoverySetting'
import { ForkPrBabysitSetting } from '../pr-babysit/ForkPrBabysitSetting'
import { ForkAccountChipSetting } from '../claude-account-chip/ForkAccountChipSetting'
import { ForkUsageReportSettings } from '../usage-report/ForkUsageReportSettings'
import { ForkPooledLimitsSetting } from '../pooled-limits/ForkPooledLimitsSetting'
import { ForkLostWorkSettings } from '../lost-work/ForkLostWorkSettings'
import { ForkSyncNoticeSetting } from '../sync-status/ForkSyncNoticeSetting'
import { ForkAutoPlacementSetting } from '../auto-placement/ForkAutoPlacementSetting'
import { ForkBatchStartSetting } from '../batch-start/ForkBatchStartSetting'
import { ForkBestOfSetting } from '../best-of/ForkBestOfSetting'
import { ForkEndpointFailoverSetting } from '../endpoint-failover/ForkEndpointFailoverSetting'
import { ForkWorktreeMoveSettings } from '../worktree-move/ForkWorktreeMoveSettings'
import { ForkApfsCloneSetting } from '../apfs-clone/ForkApfsCloneSetting'
import { ForkSnoozeSetting } from '../snooze/ForkSnoozeSetting'
import { ForkServerSetupSetting } from '../server-setup/ForkServerSetupSetting'
import { ForkMainSyncSetting } from '../main-sync/ForkMainSyncSetting'
import { ForkBranchClashesSetting } from '../branch-clashes/ForkBranchClashesSetting'
import { ForkReviewGuideSetting } from '../review-guide/ForkReviewGuideSetting'
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
    ['chat-handoff', ForkChatHandoffSetting],
    ['chat-sleep', ForkChatSleepSetting],
    ['sleepers', ForkSleepersSetting],
    ['chat-stall', ForkChatStallSetting],
    ['cache-cold', ForkCacheColdSetting],
    ['boundary-compaction', ForkBoundaryCompactionSetting],
    ['mcp-profile', ForkMcpProfileSetting],
    ['visual-fallback', ForkVisualFallbackSetting]
  ],
  agents: [
    ['child-tally', ForkChildTallySetting],
    ['row-status', ForkRowStatusSetting],
    ['agent-state-color', ForkAgentStateColorSetting],
    ['worker-cleanup', ForkWorkerCleanupSetting],
    ['agent-queue', ForkAgentQueueSetting],
    ['launch-defaults', ForkLaunchDefaultsSetting],
    ['memory', ForkMemorySettings],
    ['auto-placement', ForkAutoPlacementSetting],
    ['batch-start', ForkBatchStartSetting]
  ],
  'idle-recovery': [
    ['idle-recovery', ForkIdleRecoverySetting],
    ['pr-babysit', ForkPrBabysitSetting]
    ['agent-guards', ForkAgentGuardsSetting]
    ['best-of', ForkBestOfSetting]
  ],
  usage: [
    ['account-chip', ForkAccountChipSetting],
    ['usage-report', ForkUsageReportSettings],
    ['pooled-limits', ForkPooledLimitsSetting]
  ],
  projects: [
    ['lost-work', ForkLostWorkSettings],
    ['worktree-move', ForkWorktreeMoveSettings],
    ['apfs-clone', ForkApfsCloneSetting],
    ['main-sync', ForkMainSyncSetting],
    ['snooze', ForkSnoozeSetting],
    ['server-setup', ForkServerSetupSetting],
    ['branch-clashes', ForkBranchClashesSetting],
    ['review-guide', ForkReviewGuideSetting],
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
