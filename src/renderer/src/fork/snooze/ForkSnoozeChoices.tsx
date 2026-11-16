// Snooze (FORK.md, SLRM-2269): the snooze choices one workspace or chat menu shows: the timed
// presets, until merged, until idle, and Custom... (which opens the time picker).
import React, { useState } from 'react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkSnoozePresets,
  forkSnoozeTimeText,
  type ForkSnoozePresetId,
  type ForkSnoozeTarget
} from '../../../../shared/fork/snooze'
import { snoozeForkTarget } from './snooze-client'
import { useForkSnoozeSettings } from './use-fork-snooze'
import { openForkSnoozeCustomDialog } from './ForkSnoozeCustomDialog'

export function ForkSnoozeChoices({
  target,
  label,
  disabled
}: {
  target: ForkSnoozeTarget
  label: string
  disabled?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const settings = useForkSnoozeSettings()
  // The menu mounts when it opens, so its times are read once, then.
  const [now] = useState(() => Date.now())
  const names: Record<ForkSnoozePresetId, string> = {
    hour: t('fork.snooze.preset.hour', '1 hour'),
    evening: t('fork.snooze.preset.evening', 'This evening'),
    tomorrow: t('fork.snooze.preset.tomorrow', 'Tomorrow morning'),
    monday: t('fork.snooze.preset.monday', 'Next Monday morning')
  }
  // A chat settles on its workspace's merge, so it needs a known workspace.
  const canMerge = target.kind === 'workspace' || target.worktreeId !== null
  return (
    <>
      {forkSnoozePresets(now, settings).map((preset) => (
        <DropdownMenuItem
          key={preset.id}
          disabled={disabled}
          onSelect={() => void snoozeForkTarget(target, { kind: 'time', at: preset.at }, label)}
        >
          <span className="flex-1">{names[preset.id]}</span>
          <span className="text-muted-foreground">{forkSnoozeTimeText(preset.at, now)}</span>
        </DropdownMenuItem>
      ))}
      {canMerge ? (
        <DropdownMenuItem
          disabled={disabled}
          onSelect={() => void snoozeForkTarget(target, { kind: 'merge' }, label)}
        >
          {t('fork.snooze.until.merge', 'Until its pull request merges')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() =>
          void snoozeForkTarget(target, { kind: 'idle', days: settings.idleDays }, label)
        }
      >
        {t('fork.snooze.until.idle', 'Until idle for {{count}} days', {
          count: settings.idleDays
        })}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => openForkSnoozeCustomDialog({ target, label })}
      >
        {t('fork.snooze.until.custom', 'Custom...')}
      </DropdownMenuItem>
    </>
  )
}
