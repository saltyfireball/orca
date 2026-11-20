// Bot row badges and color (FORK.md "Bot row badges and colors"): count pills beside a bot's
// name, an idle look for its picture, and the per-bot tint. Every input is a count or state the
// row already holds, so the pills agree with the row's own line and status dots.
import React from 'react'
import { AgentWorkingSpinner } from '@/components/agent/status/AgentWorkingSpinner'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type { Bot } from '../../../../shared/bot-types'
import {
  forkBotRowBadgesEnabled,
  forkBotRowColor,
  forkBotRowColorStyle,
  forkBotRowState,
  type ForkBotRowCounts,
  type ForkBotRowState
} from '../../../../shared/fork/bot-row-badges'
import { botSidebarEntryKey } from '@/components/bots/bot-sidebar-entry-keys'

export type ForkBotRowDecor = {
  state: ForkBotRowState
  counts: ForkBotRowCounts
  /** The badge setting; the color shows either way. */
  badges: boolean
  color: string | null
}

export function useForkBotRowDecor(
  bot: Bot,
  input: { counts: ForkBotRowCounts; offline: boolean; stopped: boolean }
): ForkBotRowDecor {
  // Primitive selections, so unrelated settings writes do not repaint every row.
  const badges = useAppStore((s) => forkBotRowBadgesEnabled(s.settings))
  const color = useAppStore((s) => forkBotRowColor(s.settings, botSidebarEntryKey(bot)))
  const state = forkBotRowState({ ...input, paused: bot.paused })
  return { state, counts: input.counts, badges, color }
}

/** The pills: Needs you in the attention color, then Working with the working spinner. */
export function ForkBotRowPills({ decor }: { decor: ForkBotRowDecor }): React.JSX.Element | null {
  const t = useTranslate()
  const { state, counts } = decor
  if (!decor.badges || state === 'offline' || state === 'paused') {
    return null
  }
  const needsYou =
    counts.needsYou > 0
      ? t('fork.botRowBadges.needYou', '{{count}} need you', {
          count: counts.needsYou,
          defaultValue_one: '{{count}} needs you'
        })
      : null
  const working =
    counts.working > 0
      ? t('fork.botRowBadges.working', '{{count}} working', { count: counts.working })
      : null
  if (!needsYou && !working) {
    return null
  }
  return (
    <span className="flex shrink-0 items-center gap-1" data-fork-bot-row-pills="">
      {needsYou ? (
        <span
          role="img"
          aria-label={needsYou}
          title={needsYou}
          data-fork-bot-needs-you={counts.needsYou}
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-agent-question px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
        >
          {counts.needsYou}
        </span>
      ) : null}
      {working ? (
        <span
          role="img"
          aria-label={working}
          title={working}
          data-fork-bot-working={counts.working}
          className="flex h-4 items-center gap-0.5 rounded-full bg-agent-working/15 px-1 text-[10px] leading-none font-semibold text-foreground tabular-nums"
        >
          <AgentWorkingSpinner className="size-2" />
          {counts.working}
        </span>
      ) : null}
    </span>
  )
}

/** An idle bot's picture is quieter than a working or waiting one's. */
export function forkBotRowAvatarClassName(decor: ForkBotRowDecor | null | undefined): string {
  return decor?.badges && decor.state === 'idle' ? 'opacity-70 grayscale-[40%]' : ''
}

/** The tint over the row, and a ring for the picture's wrapper. Parent must be `relative`. */
export function ForkBotRowTint({
  color
}: {
  color: string | null | undefined
}): React.JSX.Element | null {
  return color ? (
    <span
      aria-hidden
      data-fork-bot-color={color}
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={forkBotRowColorStyle(color)}
    />
  ) : null
}

export function forkBotRowRingClassName(): string {
  return 'rounded-md'
}

export function forkBotRowRingStyle(
  color: string | null | undefined
): React.CSSProperties | undefined {
  return color ? { boxShadow: `0 0 0 2px ${color}` } : undefined
}

/** The folded Bots header's total: how many bots need you, after the faces. */
export function ForkBotHeaderRollup({ count }: { count: number }): React.JSX.Element | null {
  const t = useTranslate()
  const badges = useAppStore((s) => forkBotRowBadgesEnabled(s.settings))
  if (!badges || count <= 0) {
    return null
  }
  const label = t('fork.botRowBadges.needYou', '{{count}} need you', {
    count,
    defaultValue_one: '{{count}} needs you'
  })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-fork-bot-header-needs-you={count}
      className="ml-1 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-agent-question px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
    >
      {count}
    </span>
  )
}
