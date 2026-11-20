// Quick task (SLRM-2428, FORK.md): the box the shortcut opens. One text field and a mic; Enter
// sends, Shift+Enter adds a line, Esc closes. After sending it says which bot took the task, with
// a button to open that chat, and closes itself a moment later unless the pointer is on it.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  FORK_QUICK_TASK_CLOSE_AFTER_MS,
  type ForkQuickTaskApi
} from '../../../../shared/fork/quick-task'
import {
  QUICK_TASK_TEXT_MAX,
  type QuickTaskSubmitResult
} from '../../../../shared/fork/quick-task-contract'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { useQuickTaskDictation } from './use-quick-task-dictation'

type Status =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; result: QuickTaskSubmitResult }
  | { kind: 'failed'; message: string }

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // ipcRenderer.invoke wraps main's error: keep only main's words.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function QuickTaskBox({
  api,
  voice
}: {
  api: ForkQuickTaskApi
  voice: GlobalSettings['voice'] | undefined
}): React.JSX.Element {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'editing' })
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const dictation = useQuickTaskDictation(voice, (heard) =>
    setText((current) => (current.trim() ? `${current.trimEnd()} ${heard}` : heard))
  )

  const reset = useCallback((): void => {
    setText('')
    setStatus({ kind: 'editing' })
    fieldRef.current?.focus()
  }, [])

  useEffect(() => api.onShown(reset), [api, reset])
  useEffect(() => fieldRef.current?.focus(), [])

  // Closes a moment after sending; the pointer on the box holds it open, and leaving starts over.
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (status.kind !== 'sent' || hovered) {
      return
    }
    const timer = setTimeout(() => api.close(), FORK_QUICK_TASK_CLOSE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [api, hovered, status.kind])

  const close = useCallback((): void => {
    dictation.cancel()
    api.close()
  }, [api, dictation])

  const submit = useCallback(async (): Promise<void> => {
    const task = text.trim()
    if (!task || status.kind === 'sending') {
      return
    }
    if (dictation.phase === 'listening' || dictation.phase === 'starting') {
      await dictation.stop()
    }
    setStatus({ kind: 'sending' })
    try {
      setStatus({ kind: 'sent', result: await api.submit(task) })
    } catch (error) {
      setStatus({ kind: 'failed', message: errorText(error) })
    }
  }, [api, dictation, status.kind, text])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const listening = dictation.phase === 'listening' || dictation.phase === 'starting'
  const micLabel = listening
    ? t('fork.quickTask.box.stopDictation', 'Stop dictation')
    : dictation.phase === 'off'
      ? t(
          'fork.quickTask.box.dictationOff',
          'Turn on dictation in Settings > Voice to speak a task'
        )
      : t('fork.quickTask.box.dictate', 'Dictate')

  return (
    <div
      className="flex h-screen flex-col gap-2 rounded-xl border border-border bg-background p-3 text-foreground"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2">
        <textarea
          ref={fieldRef}
          className="min-h-16 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label={t('fork.quickTask.box.label', 'Task')}
          placeholder={t(
            'fork.quickTask.box.placeholder',
            'What needs doing, and for which project?'
          )}
          maxLength={QUICK_TASK_TEXT_MAX}
          value={text}
          disabled={status.kind === 'sending' || status.kind === 'sent'}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          size="icon"
          variant={listening ? 'default' : 'ghost'}
          aria-label={micLabel}
          title={micLabel}
          disabled={dictation.phase === 'off' || dictation.phase === 'finishing'}
          onClick={dictation.toggle}
        >
          {dictation.phase === 'finishing' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : listening ? (
            <Square className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
      </div>
      <div className="flex min-h-7 items-center justify-between gap-2 text-xs text-muted-foreground">
        <QuickTaskStatusLine
          status={status}
          dictationError={dictation.error}
          listening={listening}
        />
        {status.kind === 'sent' && status.result.chatId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void api.openChat(status.result.chatId!).catch(() => undefined)}
          >
            {t('fork.quickTask.box.openChat', 'Open chat')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function QuickTaskStatusLine({
  status,
  dictationError,
  listening
}: {
  status: Status
  dictationError: string | null
  listening: boolean
}): React.JSX.Element {
  const t = useTranslate()
  if (status.kind === 'sending') {
    return <span>{t('fork.quickTask.box.sending', 'Sending...')}</span>
  }
  if (status.kind === 'sent') {
    return (
      <span className="text-foreground">
        {t('fork.quickTask.box.sent', 'Sent to {{bot}}.', { bot: status.result.botName })}{' '}
        {status.result.note}
      </span>
    )
  }
  if (status.kind === 'failed') {
    return <span className="text-destructive">{status.message}</span>
  }
  if (dictationError) {
    return <span className="text-destructive">{dictationError}</span>
  }
  return (
    <span>
      {listening
        ? t('fork.quickTask.box.listening', 'Listening. Press the mic again to stop.')
        : t('fork.quickTask.box.hint', 'Enter sends, Shift+Enter adds a line, Esc closes.')}
    </span>
  )
}
