// Snooze (FORK.md, SLRM-2269): the menu's Custom... choice, a date and time to snooze until.
// Mounted once at the app root through ForkRootHosts.
import React, { useState, useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkSnoozePresets,
  forkSnoozeWakeLabel,
  FORK_SNOOZE_MAX_AHEAD_MS,
  type ForkSnoozeTarget
} from '../../../../shared/fork/snooze'
import { snoozeForkTarget } from './snooze-client'
import { useForkSnoozeSettings } from './use-fork-snooze'

type Request = { target: ForkSnoozeTarget; label: string }

let request: Request | null = null
const listeners = new Set<() => void>()

function setRequest(next: Request | null): void {
  request = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openForkSnoozeCustomDialog(next: Request): void {
  setRequest(next)
}

/** A datetime-local value (local time, minutes) for a timestamp. */
export function toLocalInputValue(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The timestamp a datetime-local value names, or null when it is empty or malformed. */
export function fromLocalInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) {
    return null
  }
  const [, y, mo, d, h, mi] = match.map(Number)
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
}

function CustomForm({ current }: { current: Request }): React.JSX.Element {
  const t = useTranslate()
  const settings = useForkSnoozeSettings()
  const [now] = useState(() => Date.now())
  const tomorrow = forkSnoozePresets(now, settings).find((preset) => preset.id === 'tomorrow')
  const [value, setValue] = useState(() => toLocalInputValue(tomorrow?.at ?? now + 3_600_000))
  const at = fromLocalInputValue(value)
  const valid = at !== null && at > now && at - now <= FORK_SNOOZE_MAX_AHEAD_MS
  const submit = (): void => {
    if (at === null || !valid) {
      return
    }
    setRequest(null)
    void snoozeForkTarget(current.target, { kind: 'time', at }, current.label)
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Input
        type="datetime-local"
        value={value}
        min={toLocalInputValue(now)}
        aria-label={t('fork.snooze.custom.inputLabel', 'Snooze until')}
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {valid && at !== null
          ? forkSnoozeWakeLabel({ kind: 'time', at }, now)
          : t('fork.snooze.custom.invalid', 'Pick a time ahead, within a year.')}
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => setRequest(null)}>
          {t('fork.snooze.custom.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!valid}>
          {t('fork.snooze.custom.submit', 'Snooze')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ForkSnoozeCustomDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const current = useSyncExternalStore(subscribe, () => request)
  if (!current) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('fork.snooze.custom.title', 'Snooze until')}</DialogTitle>
          <DialogDescription>
            {t(
              'fork.snooze.custom.description',
              '{{name}} leaves the sidebar until then, or sooner if it needs you.',
              { name: current.label }
            )}
          </DialogDescription>
        </DialogHeader>
        <CustomForm current={current} />
      </DialogContent>
    </Dialog>
  )
}
