import { describe, expect, it } from 'vitest'
import { parseLimitDuration, parseLimitResetClock, readLimitScreen } from './limit-resume-parse'

const NY = 'America/New_York'
// 2026-11-17 10:00 in New York (UTC-5).
const NOW = Date.UTC(2026, 10, 17, 15, 0)

const nyAt = (day: number, hour: number, minute = 0): number =>
  Date.UTC(2026, 10, day, hour + 5, minute)

describe('parseLimitResetClock', () => {
  it('reads a clock time later today, or tomorrow once it has passed', () => {
    expect(parseLimitResetClock('3pm', NOW, NY)).toBe(nyAt(17, 15))
    expect(parseLimitResetClock('3:45 PM', NOW, NY)).toBe(nyAt(17, 15, 45))
    expect(parseLimitResetClock('9am', NOW, NY)).toBe(nyAt(18, 9))
    expect(parseLimitResetClock('14:30', NOW, NY)).toBe(nyAt(17, 14, 30))
  })

  it('takes the zone the provider named over the machine zone', () => {
    expect(parseLimitResetClock('3pm (America/Los_Angeles)', NOW, NY)).toBe(nyAt(17, 18))
    expect(parseLimitResetClock('3pm (Not/AZone)', NOW, NY)).toBe(nyAt(17, 15))
  })

  it('reads a weekday, a month and day, and an ISO time', () => {
    // 2026-11-17 is a Tuesday.
    expect(parseLimitResetClock('Thu 12:00am', NOW, NY)).toBe(nyAt(19, 0))
    expect(parseLimitResetClock('Tue 9am', NOW, NY)).toBe(nyAt(24, 9))
    expect(parseLimitResetClock('Nov 20, 2pm', NOW, NY)).toBe(nyAt(20, 14))
    expect(parseLimitResetClock('Nov 20th, 2026 1:00 PM', NOW, NY)).toBe(nyAt(20, 13))
    expect(parseLimitResetClock('2026-11-18 00:00 UTC', NOW, NY)).toBe(Date.UTC(2026, 10, 18))
  })

  it('refuses what it cannot read and resets too far ahead', () => {
    expect(parseLimitResetClock('soon', NOW, NY)).toBeNull()
    expect(parseLimitResetClock('Dec 30, 2pm', NOW, NY)).toBeNull()
    expect(parseLimitResetClock('13pm', NOW, NY)).toBeNull()
  })
})

describe('parseLimitDuration', () => {
  it('adds the parts of a duration', () => {
    expect(parseLimitDuration('2 hours 5 minutes', NOW)).toBe(NOW + 125 * 60_000)
    expect(parseLimitDuration('1 day 3 hours', NOW)).toBe(NOW + 27 * 3_600_000)
    expect(parseLimitDuration('less than a minute', NOW)).toBe(NOW + 60_000)
    expect(parseLimitDuration('a while', NOW)).toBeNull()
  })
})

const screen = (...rows: string[]): string[] => ['', 'some earlier output', ...rows, '']

describe('readLimitScreen', () => {
  it('finds a Claude Code session limit and its reset', () => {
    const read = readLimitScreen(
      screen(
        "  \u23bf  You've hit your session limit \u00b7 resets 3:45pm (America/New_York)",
        '     /upgrade to increase your usage limit.',
        '',
        '> ',
        '  ? for shortcuts'
      ),
      NOW
    )
    expect(read).toMatchObject({ kind: 'limit', resetsAt: nyAt(17, 15, 45), selfContinue: false })
  })

  it('reads the older wording and the 5-hour line', () => {
    expect(
      readLimitScreen(
        screen('Claude usage limit reached. Your limit will reset at 3pm (America/New_York).'),
        NOW
      )
    ).toMatchObject({ kind: 'limit', resetsAt: nyAt(17, 15) })
    expect(
      readLimitScreen(screen('5-hour limit reached \u2219 resets 3pm'), NOW, NY)
    ).toMatchObject({
      kind: 'limit',
      resetsAt: nyAt(17, 15)
    })
  })

  it('marks Claude Code going on by itself', () => {
    expect(
      readLimitScreen(
        screen(
          'Usage limit reached \u00b7 continuing automatically at 3:45pm \u00b7 esc to cancel'
        ),
        NOW,
        NY
      )
    ).toMatchObject({ kind: 'limit', selfContinue: true, resetsAt: nyAt(17, 15, 45) })
  })

  it('finds a Codex limit with a clock or a wait, wrapped over rows', () => {
    expect(
      readLimitScreen(
        screen(
          "\u25a0 You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit",
          'https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:45 PM.',
          '',
          '\u203a Ask Codex to do anything'
        ),
        NOW,
        NY
      )
    ).toMatchObject({ kind: 'limit', resetsAt: nyAt(17, 15, 45) })
    expect(
      readLimitScreen(
        screen("You've hit your usage limit. Try again in 2 hours 5 minutes."),
        NOW,
        NY
      )
    ).toMatchObject({ kind: 'limit', resetsAt: NOW + 125 * 60_000 })
  })

  it('gives no reset when none is printed, and counts repeats of the same line', () => {
    const line = "You've hit your usage limit."
    expect(readLimitScreen(screen(line, 'x', line), NOW)).toMatchObject({
      kind: 'limit',
      resetsAt: null,
      occurrences: 2
    })
  })

  it('leaves limits no clock lifts, warnings and old stops alone', () => {
    expect(
      readLimitScreen(screen("You've hit your monthly spend limit \u00b7 raise it"), NOW).kind
    ).toBe('none')
    expect(
      readLimitScreen(
        screen('Usage limit reached', 'Request a limit increase from your owner to continue.'),
        NOW
      ).kind
    ).toBe('none')
    expect(
      readLimitScreen(screen("You've used 85% of your session limit \u00b7 resets 3pm"), NOW).kind
    ).toBe('none')
    expect(readLimitScreen(screen('Usage limit reached \u00b7 wrapping up'), NOW).kind).toBe('none')
    const old = ["You've hit your session limit \u00b7 resets 3pm", ...Array(30).fill('work')]
    expect(readLimitScreen(old, NOW).kind).toBe('none')
  })

  it('sees the Codex model-switch menu', () => {
    expect(
      readLimitScreen(
        screen(
          'Approaching rate limits',
          'Switch to gpt-5-codex-mini for lower credit usage?',
          '\u203a 1. Switch to gpt-5-codex-mini',
          '  2. Keep current model',
          '  3. Keep current model (never show again)'
        ),
        NOW
      ).kind
    ).toBe('codex-switch-prompt')
  })
})
