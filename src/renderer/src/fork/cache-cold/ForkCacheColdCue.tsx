// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): a quiet line above the composer when
// the chat's prompt cache has likely expired and its context is large, so the next send re-reads
// it at full price. Offers to compact first. Never holds a send back.
import React, { useCallback, useRef, useState } from 'react'
import { Snowflake } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { readNativeChatDraftCache } from '@/components/native-chat/drafts/native-chat-draft-views'
import { formatForkTokens } from '../../../../shared/fork/usage-ledger'
import { chatSessionIdForRow } from './cache-cold-view'
import { useForkCacheCold } from './use-fork-cache-cold'

/** The slice of the composer's structured transport the cue uses. */
export type ForkCacheColdTransport = {
  sessionId?: string
  conversationCommands?: readonly string[]
  dispatchCommand: (text: string) => Promise<{ accepted: boolean }>
}

export const FORK_COMPACT_COMMAND = '/compact'

function coldLabel(tokens: number, t: Translate): string {
  return t(
    'fork.cacheCold.cue',
    'Cache likely expired: the next message re-reads about {{tokens}} tokens.',
    { tokens: formatForkTokens(tokens) }
  )
}

/**
 * Compact, then send the draft if there is one. The draft goes through the composer's own send,
 * which queues it behind the running compaction like any message sent while a turn runs.
 */
export async function forkCompactThenSend(
  transport: Pick<ForkCacheColdTransport, 'dispatchCommand'>,
  draft: string,
  send: () => void
): Promise<boolean> {
  const outcome = await transport.dispatchCommand(FORK_COMPACT_COMMAND)
  if (!outcome.accepted) {
    return false
  }
  if (draft.trim().length > 0) {
    send()
  }
  return true
}

/** The composer props the cue reads; the cue sits in the composer wrapper, not the pane. */
export type ForkCacheColdComposerProps = {
  structuredTransport?: ForkCacheColdTransport
  draftScopeKey?: string
  editSession?: unknown
  launchPrompt?: unknown
}

export function ForkCacheColdCue({
  composer,
  handle
}: {
  composer: ForkCacheColdComposerProps
  handle: React.RefObject<{ submit?: () => void } | null>
}): React.JSX.Element | null {
  const transport = composer.structuredTransport
  const hidden = Boolean(composer.editSession || composer.launchPrompt)
  const verdict = useForkCacheCold(hidden ? undefined : transport?.sessionId)
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  if (!transport || !verdict.cold) {
    return null
  }
  const canCompact = transport.conversationCommands?.includes('compact') === true
  const compactFirst = (): void => {
    const scope = composer.draftScopeKey
    const draft = scope ? readNativeChatDraftCache(scope) : ''
    setBusy(true)
    void forkCompactThenSend(transport, draft, () => handle.current?.submit?.())
      .catch(() => false)
      .finally(() => setBusy(false))
  }
  return (
    <div
      className="flex items-center gap-2 px-3 pb-1 text-xs text-muted-foreground"
      data-fork-cache-cold=""
    >
      <Snowflake className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{coldLabel(verdict.tokens, t)}</span>
      {canCompact ? (
        <button
          type="button"
          className="shrink-0 rounded px-1 underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          disabled={busy}
          title={t(
            'fork.cacheCold.compactHelp',
            'Run /compact now, then send your message (if any) on the smaller context.'
          )}
          onClick={compactFirst}
        >
          {t('fork.cacheCold.compact', 'Compact first')}
        </button>
      ) : null}
    </div>
  )
}

/** Sets a forwarded ref, outside the hook so the compiler never sees the caller's ref mutated. */
function setForwardedRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

/** Hands the composer handle to both the caller's ref and the cue. */
export function useForkComposerHandleRef<T>(
  ref: React.ForwardedRef<T>
): [React.RefCallback<T>, React.RefObject<T | null>] {
  const own = useRef<T | null>(null)
  const merged = useCallback(
    (value: T | null) => {
      own.current = value
      setForwardedRef(ref, value)
    },
    [ref]
  )
  return [merged, own]
}

/** A sidebar or dashboard agent row's snowflake, shown while that chat's cache is likely cold. */
export function ForkCacheColdRowMark({
  agent
}: {
  agent: { paneKey: string; tab: { id: string; worktreeId: string }; rowSource?: string }
}): React.JSX.Element | null {
  const sessionId = useAppStore((s) =>
    agent.rowSource === 'subagent'
      ? undefined
      : chatSessionIdForRow(
          s.unifiedTabsByWorktree[agent.tab.worktreeId],
          agent.tab.id,
          agent.paneKey
        )
  )
  return <ForkCacheColdMark sessionId={sessionId} />
}

/** The snowflake for one chat; on a chat tab it sits before the title. */
export function ForkCacheColdMark({
  sessionId,
  className = 'inline-flex shrink-0'
}: {
  sessionId: string | undefined
  className?: string
}): React.JSX.Element | null {
  const verdict = useForkCacheCold(sessionId)
  const t = useTranslate()
  if (!verdict.cold) {
    return null
  }
  const label = coldLabel(verdict.tokens, t)
  return (
    <span className={className} title={label} data-fork-cache-cold="">
      <Snowflake className="size-[13px] text-muted-foreground" aria-label={label} />
    </span>
  )
}
