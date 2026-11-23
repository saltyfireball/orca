// Needs you (FORK.md "Needs you list", BAD-759): the list. A filter box over rows grouped by bot or
// agent, the most recent ask first. Arrow keys move, Enter (or a click) jumps there, Escape closes.
// The selected row opens to its quick answers: a press on an option or on Send answers, and no key
// does. Stalled and paused chats stay in the Decision inbox, linked from the footer.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useShortcutLabel } from '@/lib/keyboard/useShortcutLabel'
import { BotAvatar } from '@/components/bots/BotAvatar'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import type { TerminalAgent } from '../../../../shared/agent-status/identity/terminal-agent'
import { sleeperAge } from '../sleepers/ForkSleepersRow'
import {
  forkDecisionInboxAvailable,
  openForkDecisionInbox
} from '../decision-inbox/decision-inbox-store'
import { jumpToNeedsYou } from './needs-you-jump'
import { needsYouAnswerPlan, sendNeedsYouAnswer, type NeedsYouAnswerPlan } from './needs-you-answer'
import {
  closeNeedsYou,
  useNeedsYouData,
  useNeedsYouOpen,
  useNeedsYouQuickAnswers
} from './needs-you-store'
import {
  filterNeedsYouGroups,
  needsYouFlat,
  needsYouGroups,
  needsYouMove,
  type NeedsYouEntry
} from './needs-you-view'

const AGE_TICK_MS = 30_000

function Picture({ entry }: { entry: NeedsYouEntry }): React.JSX.Element {
  if (entry.bot) {
    return <BotAvatar bot={entry.bot} className="size-6 shrink-0 rounded-md text-xs" />
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
      {/* oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: an unknown agent name draws the neutral icon. */}
      <AgentIcon agent={entry.agent as TerminalAgent | null} size={14} />
    </span>
  )
}

function openHint(entry: NeedsYouEntry, t: Translate): string {
  if (entry.target.kind === 'agent') {
    return t(
      'fork.needsYou.hintAgent',
      'Approvals and questions are answered in the agent’s own prompt. Enter goes there.'
    )
  }
  if (entry.target.kind === 'board') {
    return t('fork.needsYou.hintBoard', 'Enter goes to the chat that filed it.')
  }
  return t(
    'fork.needsYou.hintOpen',
    'This one asks more than one question, or has steps for you. Enter opens it.'
  )
}

function Answer({
  entry,
  plan,
  onAnswered
}: {
  entry: NeedsYouEntry
  plan: Exclude<NeedsYouAnswerPlan, { kind: 'open' }>
  onAnswered: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = (words: string): void => {
    if (busy || !words.trim()) {
      return
    }
    setBusy(true)
    void sendNeedsYouAnswer(entry, plan, words)
      .then((sent) => {
        if (sent) {
          setText('')
          onAnswered()
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <div className="flex flex-col gap-2 pt-2" data-needs-you-answer="">
      {plan.kind === 'bot' && plan.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {plan.options.map((option) => (
            <Button
              key={option.label}
              type="button"
              size="xs"
              variant={option.recommended ? 'default' : 'outline'}
              disabled={busy}
              title={option.detail}
              onClick={() => send(option.label)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          rows={2}
          disabled={busy}
          aria-label={t('fork.needsYou.answerLabel', 'Your answer')}
          placeholder={t('fork.needsYou.answerPlaceholder', 'Type an answer, then press Send')}
          className="min-h-0 flex-1 resize-none text-sm"
          // Enter only adds a line: an answer goes out on Send, never on a key.
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type="button"
          size="xs"
          disabled={busy || text.trim().length === 0}
          onClick={() => send(text)}
        >
          {t('fork.needsYou.send', 'Send')}
        </Button>
      </div>
    </div>
  )
}

function Row({
  entry,
  index,
  selected,
  now,
  quickAnswers,
  onSelect,
  onAnswered
}: {
  entry: NeedsYouEntry
  index: number
  selected: boolean
  now: number
  quickAnswers: boolean
  onSelect: (index: number) => void
  onAnswered: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const ref = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])
  const plan = needsYouAnswerPlan(entry, quickAnswers)
  const age = sleeperAge(Math.max(0, now - entry.since), t)
  return (
    <li
      ref={ref}
      role="option"
      aria-selected={selected}
      data-needs-you-entry={entry.key}
      className={cn(
        'cursor-pointer rounded-md px-2 py-1.5 text-sm',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
      onMouseMove={() => (selected ? undefined : onSelect(index))}
      onClick={(event) => {
        // A click on the answer controls is no jump.
        if (!(event.target instanceof Element && event.target.closest('[data-needs-you-answer]'))) {
          void jumpToNeedsYou(entry, index)
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Picture entry={entry} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {entry.number ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {entry.number}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium" title={entry.title}>
              {entry.title}
            </span>
            {entry.hostLabel ? (
              <span className="max-w-32 shrink-0 truncate rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">
                {entry.hostLabel}
              </span>
            ) : null}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{age}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground" title={entry.line}>
            {entry.line}
          </div>
        </div>
      </div>
      {selected ? (
        plan.kind === 'open' ? (
          <p className="pt-1.5 pl-8 text-xs text-muted-foreground">{openHint(entry, t)}</p>
        ) : (
          <div className="pl-8">
            <Answer entry={entry} plan={plan} onAnswered={onAnswered} />
          </div>
        )
      ) : null}
    </li>
  )
}

function Body(): React.JSX.Element {
  const t = useTranslate()
  const { entries, inboxOnly } = useNeedsYouData()
  const quickAnswers = useNeedsYouQuickAnswers()
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(0)
  // Answered entries leave the list at once, before their host's next read drops them.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  const groups = useMemo(
    () =>
      filterNeedsYouGroups(
        needsYouGroups(entries.filter((entry) => !answered.has(entry.key))),
        filter
      ),
    [entries, answered, filter]
  )
  const flat = useMemo(() => needsYouFlat(groups), [groups])
  const at = Math.min(selected, Math.max(0, flat.length - 1))
  const current = flat[at] ?? null
  const shortcut = useShortcutLabel('needsYou.open')
  const inboxAvailable = forkDecisionInboxAvailable()

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const target = event.target
    const typing = target instanceof HTMLTextAreaElement
    if (typing || event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = needsYouMove(flat.length, at, event.key === 'ArrowDown' ? 1 : -1)
      if (next !== null) {
        event.preventDefault()
        setSelected(next)
      }
      return
    }
    // Enter jumps only from the filter box or the list itself: on a button it is that button's press.
    const onControl = target instanceof HTMLButtonElement
    if (event.key === 'Enter' && !onControl && current) {
      event.preventDefault()
      void jumpToNeedsYou(current, at)
    }
  }

  let index = -1
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" onKeyDown={onKeyDown}>
      <input
        autoFocus
        type="text"
        value={filter}
        spellCheck={false}
        aria-label={t('fork.needsYou.filter', 'Filter')}
        placeholder={t('fork.needsYou.filterPlaceholder', 'Filter by bot, agent, item or question')}
        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onChange={(event) => {
          setFilter(event.target.value)
          setSelected(0)
        }}
      />
      <div
        role="listbox"
        aria-label={t('fork.needsYou.title', 'Needs you')}
        className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
        {flat.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? t('fork.needsYou.empty', 'Nothing is waiting on you.')
              : t('fork.needsYou.noMatch', 'Nothing matches that filter.')}
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.name}>
            <h3 className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">
              {group.name} ({group.entries.length})
            </h3>
            <ul>
              {group.entries.map((entry) => {
                index += 1
                return (
                  <Row
                    key={entry.key}
                    entry={entry}
                    index={index}
                    selected={index === at}
                    now={now}
                    quickAnswers={quickAnswers}
                    onSelect={setSelected}
                    onAnswered={() => setAnswered((held) => new Set(held).add(entry.key))}
                  />
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {t('fork.needsYou.keys', 'Up and Down choose, Enter goes there, Esc closes')} ({shortcut})
        </span>
        {inboxAvailable ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              closeNeedsYou()
              openForkDecisionInbox()
            }}
          >
            {inboxOnly > 0
              ? t('fork.needsYou.inboxStalled', 'Decision inbox ({{count}} stalled or paused)', {
                  count: inboxOnly
                })
              : t('fork.needsYou.inbox', 'Decision inbox')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** The list, as a dialog over whatever is open; closes on Escape and returns focus where it was. */
export function ForkNeedsYouList(): React.JSX.Element | null {
  const t = useTranslate()
  const open = useNeedsYouOpen()
  if (!open) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          closeNeedsYou()
        }
      }}
    >
      <DialogContent className="flex max-h-[70vh] flex-col gap-3 sm:max-w-xl">
        <DialogTitle>{t('fork.needsYou.title', 'Needs you')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(
            'fork.needsYou.description',
            'Everything that is waiting on you. Choose one to go there.'
          )}
        </DialogDescription>
        <Body />
      </DialogContent>
    </Dialog>
  )
}
