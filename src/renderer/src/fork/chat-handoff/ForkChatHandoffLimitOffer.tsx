// Chat handoff (FORK.md, SLRM-2391): with `forkChatHandoffOnLimit` at 'offer' (the default), a
// native chat on this desktop that limit resume parks on a usage limit gets a toast offering to
// hand it to the other agent. Each stop is offered once. Mounted in ForkRootHosts.
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  chatHandoffAgentLabel,
  chatHandoffLimitKey,
  chatHandoffLimitTarget,
  readChatHandoffSettings
} from '../../../../shared/fork/chat-handoff'
import { useForkLimitResumeEntries } from '../limit-resume/limit-resume-store'
import { runChatHandoff } from './chat-handoff-client'

export function ForkChatHandoffLimitOffer(): null {
  const t = useTranslate()
  const entries = useForkLimitResumeEntries()
  const offering = useAppStore((s) => {
    const settings = readChatHandoffSettings(s.settings)
    return settings.enabled && settings.onLimit === 'offer'
  })
  const offered = useRef(new Set<string>())
  useEffect(() => {
    if (!offering) {
      return
    }
    for (const entry of entries) {
      const to = chatHandoffLimitTarget(entry)
      const key = chatHandoffLimitKey(entry)
      const sessionId = entry.sessionId
      if (!to || !sessionId || offered.current.has(key)) {
        continue
      }
      offered.current.add(key)
      toast.info(
        t(
          'fork.chatHandoff.limitOffer',
          '"{{name}}" stopped on its {{from}} usage limit. Hand it off to {{to}}?',
          {
            name: entry.title || t('fork.chatHandoff.thisChat', 'A chat'),
            from: chatHandoffAgentLabel(entry.agent),
            to: chatHandoffAgentLabel(to)
          }
        ),
        {
          duration: 30_000,
          action: {
            label: t('fork.chatHandoff.limitOfferAction', 'Hand off'),
            onClick: () => {
              void runChatHandoff({ kind: 'local' }, { sessionId, to })
            }
          }
        }
      )
    }
  }, [entries, offering, t])
  return null
}
