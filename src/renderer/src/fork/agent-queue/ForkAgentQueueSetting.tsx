// SLRM-2098 (FORK.md "Agent launch queue"): the agent limit. Ships off; the main process reads
// it on every launch.
import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_AGENT_QUEUE_DEFAULT_MAX_LIVE,
  forkAgentQueueConfigOf,
  FORK_AGENT_QUEUE_MAX_LIMIT
} from '../../../../shared/fork/agent-queue'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function LimitInput({
  value,
  label,
  onCommit
}: {
  value: number
  label: string
  onCommit: (next: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    const parsed = Number.parseInt(draft ?? '', 10)
    setDraft(null)
    if (Number.isFinite(parsed)) {
      onCommit(Math.min(FORK_AGENT_QUEUE_MAX_LIMIT, Math.max(1, parsed)))
    }
  }
  return (
    <Input
      type="number"
      min={1}
      max={FORK_AGENT_QUEUE_MAX_LIMIT}
      aria-label={label}
      className="w-20"
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}

export function ForkAgentQueueSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = forkAgentQueueConfigOf(settings)
  const maxLiveLabel = config.separate
    ? t('fork.agentQueue.setting.maxInteractive', 'Most chats you start running at once')
    : t('fork.agentQueue.setting.maxLive', 'Most agents running at once')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.agentQueue.setting.title', 'Agent limit')}
        description={t(
          'fork.agentQueue.setting.description',
          'Cap how many agents run at once. New launches past the cap wait in a queue and start in order as running agents stop. Sleeping chats do not count.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.agentQueue.setting.enabled', 'Limit running agents')}
        checked={config.enabled}
        onChange={() => updateSettings({ forkAgentQueueEnabled: !config.enabled })}
      />
      {config.enabled ? (
        <>
          <SettingsRow
            label={maxLiveLabel}
            description={t(
              'fork.agentQueue.setting.maxLiveHelp',
              'Default {{count}}. Chats you start go ahead of orchestration workers in the queue.',
              { count: FORK_AGENT_QUEUE_DEFAULT_MAX_LIVE }
            )}
            control={
              <LimitInput
                value={config.maxLive}
                label={maxLiveLabel}
                onCommit={(next) => updateSettings({ forkAgentQueueMaxLive: next })}
              />
            }
          />
          <SettingsSwitchRow
            label={t('fork.agentQueue.setting.separate', 'Separate limit for workers')}
            description={t(
              'fork.agentQueue.setting.separateHelp',
              'Orchestration workers get their own cap instead of sharing one with your chats.'
            )}
            checked={config.separate}
            onChange={() => updateSettings({ forkAgentQueueSeparateLimits: !config.separate })}
          />
          {config.separate ? (
            <SettingsRow
              label={t('fork.agentQueue.setting.maxWorkers', 'Most workers running at once')}
              control={
                <LimitInput
                  value={config.maxWorkers}
                  label={t('fork.agentQueue.setting.maxWorkers', 'Most workers running at once')}
                  onCommit={(next) => updateSettings({ forkAgentQueueMaxWorkers: next })}
                />
              }
            />
          ) : null}
          <SettingsSwitchRow
            label={t('fork.agentQueue.setting.resumeBypass', 'Never hold a chat that wakes')}
            description={t(
              'fork.agentQueue.setting.resumeBypassHelp',
              'Waking or resuming a chat that ran before starts at once, even at the limit. Only new launches wait.'
            )}
            checked={config.resumeBypass}
            onChange={() =>
              updateSettings({
                forkAgentQueueResumeBypass: !config.resumeBypass
              })
            }
          />
        </>
      ) : null}
    </section>
  )
}
