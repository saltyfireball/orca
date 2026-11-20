// Worker archive (FORK.md, BAD-669): where "Clean up finished workers" is offered: a bot row's
// menu and a bot's Chats tab, which lists its workers.
import React from 'react'
import { ArchiveX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { Bot } from '../../../../shared/bot-types'
import { openWorkerCleanup } from './worker-archive-store'

export function ForkBotCleanupMenuItem({ bot }: { bot: Bot }): React.JSX.Element {
  const t = useTranslate()
  return (
    <ContextMenuItem onSelect={() => openWorkerCleanup({ kind: 'bot', botName: bot.name })}>
      <ArchiveX className="size-3.5" />
      {t('fork.workerArchive.menu', 'Clean up finished workers…')}
    </ContextMenuItem>
  )
}

export function ForkBotCleanupButton({ bot }: { bot: Bot }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex justify-end px-0.5 pb-1.5">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => openWorkerCleanup({ kind: 'bot', botName: bot.name })}
      >
        <ArchiveX />
        {t('fork.workerArchive.button', 'Clean up finished workers')}
      </Button>
    </div>
  )
}
