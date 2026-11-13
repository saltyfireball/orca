// SLRM-2136: Settings > Advanced, the fork's agent lifecycle settings under one heading, in the
// order a chat lives through them: sleep (and the Sleepers list), stall, worker cleanup, the
// launch queue, launch defaults, memory. Each section is its feature's own component, unchanged.
import React from 'react'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { SettingsGroupHeader } from '@/components/settings/section-layout/SettingsGroup'
import { useTranslate } from '@/i18n/use-translate'
import { ForkChatSleepSetting } from './chat-sleep/ForkChatSleepSetting'
import { ForkSleepersSetting } from './sleepers/ForkSleepersSetting'
import { ForkChatStallSetting } from './chat-stall/ForkChatStallSetting'
import { ForkWorkerCleanupSetting } from './worker-cleanup/ForkWorkerCleanupSetting'
import { ForkAgentQueueSetting } from './agent-queue/ForkAgentQueueSetting'
import { ForkLaunchDefaultsSetting } from './launch-defaults/ForkLaunchDefaultsSetting'
import { ForkMemorySettings } from './memory-truth/ForkMemorySettings'

type ForkAgentLifecycleSettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkAgentLifecycleSettings(
  props: ForkAgentLifecycleSettingsProps
): React.JSX.Element {
  const t = useTranslate()
  return (
    <section className="space-y-6" data-fork-agent-lifecycle="">
      <SettingsGroupHeader
        title={t('fork.lifecycle.title', 'Agent lifecycle')}
        description={t(
          'fork.lifecycle.description',
          'How chats and agents sleep, stall, get cleaned up, wait to launch, start, and back off when memory runs short.'
        )}
      />
      <ForkChatSleepSetting {...props} />
      <ForkSleepersSetting {...props} />
      <ForkChatStallSetting {...props} />
      <ForkWorkerCleanupSetting {...props} />
      <ForkAgentQueueSetting {...props} />
      <ForkLaunchDefaultsSetting {...props} />
      <ForkMemorySettings {...props} />
    </section>
  )
}
