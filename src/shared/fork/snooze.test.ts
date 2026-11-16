import { describe, expect, it } from 'vitest'
import {
  findForkSnoozeEntry,
  forkSnoozePresets,
  forkSnoozeTargetKey,
  forkSnoozeTimeText,
  forkSnoozeWakeLabel,
  forkSnoozeWakeReason,
  isForkSnoozeSettle,
  parseForkSnoozeUntil,
  readForkSnoozeSettings,
  type ForkSnoozeEntry
} from './snooze'

const HOURS = { morningHour: 9, eveningHour: 18 }
// Wednesday 2026-11-18, 10:00 local time.
const WED_10 = new Date(2026, 10, 18, 10, 0).getTime()
const ALL_ON = { wakeOnAttention: true, wakeOnFailure: true, wakeOnOpen: true }

function entry(over: Partial<ForkSnoozeEntry> = {}): ForkSnoozeEntry {
  return {
    id: 'abcdef123456',
    target: { kind: 'workspace', worktreeId: 'repo::/w/a', hostId: 'local' },
    until: { kind: 'time', at: WED_10 + 3_600_000 },
    label: 'a',
    snoozedAt: WED_10,
    ...over
  }
}

describe('snooze settings', () => {
  it('defaults to on with every trigger, 9am, 6pm, 3 days and no command', () => {
    expect(readForkSnoozeSettings(undefined)).toEqual({
      enabled: true,
      wakeOnAttention: true,
      wakeOnFailure: true,
      wakeOnOpen: true,
      morningHour: 9,
      eveningHour: 18,
      idleDays: 3,
      settleCommand: ''
    })
  })

  it('reads the switches and ignores bad hours', () => {
    const read = readForkSnoozeSettings({
      forkSnooze: false,
      forkSnoozeWakeOnFailure: false,
      forkSnoozeMorningHour: 25,
      forkSnoozeEveningHour: 20,
      forkSnoozeSettleCommand: '  echo hi  '
    })
    expect(read).toMatchObject({
      enabled: false,
      wakeOnFailure: false,
      morningHour: 9,
      eveningHour: 20,
      settleCommand: 'echo hi'
    })
  })
})

describe('snooze presets', () => {
  it('offers an hour, this evening, tomorrow morning and next Monday morning', () => {
    const presets = forkSnoozePresets(WED_10, HOURS)
    expect(presets.map((p) => p.id)).toEqual(['hour', 'evening', 'tomorrow', 'monday'])
    expect(presets.map((p) => new Date(p.at).toString())).toEqual([
      new Date(2026, 10, 18, 11, 0).toString(),
      new Date(2026, 10, 18, 18, 0).toString(),
      new Date(2026, 10, 19, 9, 0).toString(),
      new Date(2026, 10, 23, 9, 0).toString()
    ])
  })

  it('drops this evening once it is near, and next Monday is a week out on a Monday', () => {
    const mondayEvening = new Date(2026, 10, 16, 17, 45).getTime()
    const presets = forkSnoozePresets(mondayEvening, HOURS)
    expect(presets.map((p) => p.id)).toEqual(['hour', 'tomorrow', 'monday'])
    expect(new Date(presets[2].at).getDate()).toBe(23)
  })

  it('makes Monday the next day on a Sunday', () => {
    const sunday = new Date(2026, 10, 22, 12, 0).getTime()
    const monday = forkSnoozePresets(sunday, HOURS).find((p) => p.id === 'monday')
    expect(new Date(monday?.at ?? 0).getDate()).toBe(23)
  })
})

describe('parseForkSnoozeUntil', () => {
  const parse = (text: string) => parseForkSnoozeUntil(text, WED_10, HOURS)

  it('reads merge, idle days and durations', () => {
    expect(parse('merge')).toEqual({ ok: true, until: { kind: 'merge' } })
    expect(parse('idle:3d')).toEqual({ ok: true, until: { kind: 'idle', days: 3 } })
    expect(parse('idle:2')).toEqual({ ok: true, until: { kind: 'idle', days: 2 } })
    expect(parse('90m')).toEqual({ ok: true, until: { kind: 'time', at: WED_10 + 90 * 60_000 } })
    expect(parse('1w')).toEqual({
      ok: true,
      until: { kind: 'time', at: WED_10 + 7 * 24 * 3_600_000 }
    })
  })

  it('reads presets, clock times and dates', () => {
    expect(parse('tomorrow')).toEqual({
      ok: true,
      until: { kind: 'time', at: new Date(2026, 10, 19, 9, 0).getTime() }
    })
    expect(parse('evening')).toEqual({
      ok: true,
      until: { kind: 'time', at: new Date(2026, 10, 18, 18, 0).getTime() }
    })
    // 08:30 has passed today, so it is tomorrow's.
    expect(parse('08:30')).toEqual({
      ok: true,
      until: { kind: 'time', at: new Date(2026, 10, 19, 8, 30).getTime() }
    })
    expect(parse('2026-11-20T14:15')).toEqual({
      ok: true,
      until: { kind: 'time', at: new Date(2026, 10, 20, 14, 15).getTime() }
    })
  })

  it('refuses the past, beyond a year, bad idle days and nonsense', () => {
    expect(parse('2026-11-01T09:00').ok).toBe(false)
    expect(parse('2028-01-01').ok).toBe(false)
    expect(parse('idle:0d').ok).toBe(false)
    expect(parse('soon').ok).toBe(false)
  })
})

describe('wake labels', () => {
  it('says the time today, the weekday this week, else the date', () => {
    expect(forkSnoozeTimeText(new Date(2026, 10, 18, 18, 0).getTime(), WED_10)).toBe('6pm')
    expect(forkSnoozeTimeText(new Date(2026, 10, 18, 18, 30).getTime(), WED_10)).toBe('6:30pm')
    expect(forkSnoozeTimeText(new Date(2026, 10, 23, 9, 0).getTime(), WED_10)).toBe('Mon 9am')
    expect(forkSnoozeTimeText(new Date(2026, 11, 2, 12, 0).getTime(), WED_10)).toBe('Dec 2 12pm')
  })

  it('labels merge and idle snoozes', () => {
    expect(forkSnoozeWakeLabel({ kind: 'merge' }, WED_10)).toBe('until merge')
    expect(forkSnoozeWakeLabel({ kind: 'idle', days: 1 }, WED_10)).toBe('until 1 idle day')
    expect(
      forkSnoozeWakeLabel({ kind: 'time', at: new Date(2026, 10, 18, 18).getTime() }, WED_10)
    ).toBe('until 6pm')
  })
})

describe('forkSnoozeWakeReason', () => {
  it('holds until its time, then wakes', () => {
    expect(forkSnoozeWakeReason(entry(), { now: WED_10 + 60_000 }, ALL_ON)).toBeNull()
    expect(forkSnoozeWakeReason(entry(), { now: WED_10 + 3_600_000 }, ALL_ON)).toBe('time')
  })

  it('wakes early on attention, failure and open, each behind its setting', () => {
    const later = WED_10 + 1000
    expect(forkSnoozeWakeReason(entry(), { now: later, attentionSince: later }, ALL_ON)).toBe(
      'attention'
    )
    expect(forkSnoozeWakeReason(entry(), { now: later, failedAt: later }, ALL_ON)).toBe('failed')
    expect(forkSnoozeWakeReason(entry(), { now: later, opened: true }, ALL_ON)).toBe('opened')
    const off = { wakeOnAttention: false, wakeOnFailure: false, wakeOnOpen: false }
    expect(
      forkSnoozeWakeReason(
        entry(),
        { now: later, attentionSince: later, failedAt: later, opened: true },
        off
      )
    ).toBeNull()
  })

  it('ignores a question or failure from before the snooze', () => {
    expect(
      forkSnoozeWakeReason(
        entry(),
        { now: WED_10 + 1000, attentionSince: WED_10 - 1, failedAt: WED_10 - 1 },
        ALL_ON
      )
    ).toBeNull()
  })

  it('settles on merge and after the idle days, counting from the last activity', () => {
    const merge = entry({ until: { kind: 'merge' } })
    expect(forkSnoozeWakeReason(merge, { now: WED_10 + 1, merged: false }, ALL_ON)).toBeNull()
    expect(forkSnoozeWakeReason(merge, { now: WED_10 + 1, merged: true }, ALL_ON)).toBe('merged')
    const idle = entry({ until: { kind: 'idle', days: 2 } })
    const day = 24 * 3_600_000
    expect(
      forkSnoozeWakeReason(idle, { now: WED_10 + 2 * day, lastActivityAt: WED_10 + day }, ALL_ON)
    ).toBeNull()
    expect(
      forkSnoozeWakeReason(idle, { now: WED_10 + 3 * day, lastActivityAt: WED_10 + day }, ALL_ON)
    ).toBe('idle')
  })

  it('settles only with the reason it was set for', () => {
    expect(isForkSnoozeSettle({ kind: 'merge' }, 'merged')).toBe(true)
    expect(isForkSnoozeSettle({ kind: 'merge' }, 'idle')).toBe(false)
    expect(isForkSnoozeSettle({ kind: 'idle', days: 1 }, 'idle')).toBe(true)
    expect(isForkSnoozeSettle({ kind: 'time', at: 1 }, 'merged')).toBe(false)
  })
})

describe('snooze ids and keys', () => {
  it('keys one snooze per workspace on its host and per chat pane', () => {
    expect(
      forkSnoozeTargetKey({ kind: 'workspace', worktreeId: 'w', hostId: 'runtime:a' })
    ).not.toBe(forkSnoozeTargetKey({ kind: 'workspace', worktreeId: 'w', hostId: 'local' }))
    expect(
      forkSnoozeTargetKey({ kind: 'chat', paneKey: 'p', worktreeId: null, hostId: 'local' })
    ).toBe(forkSnoozeTargetKey({ kind: 'chat', paneKey: 'p', worktreeId: 'w', hostId: 'x' }))
  })

  it('finds by id or a unique prefix of four or more', () => {
    const list = [entry(), entry({ id: 'abcd99999999' })]
    expect(findForkSnoozeEntry(list, 'abcdef123456').ok).toBe(true)
    expect(findForkSnoozeEntry(list, 'abcde').ok).toBe(true)
    expect(findForkSnoozeEntry(list, 'abcd').ok).toBe(false)
    expect(findForkSnoozeEntry(list, 'abc').ok).toBe(false)
  })
})
