// Decision inbox (FORK.md "Idle recovery"), item E2: the command palette entries that open the
// dialog and jump to the chat that has waited longest.
// Contract: nothing is offered while `forkIdleSweepMode` is 'off'. The stock catalog caches
// this list per language, so the entries are always built and report themselves unavailable
// while the mode is off (the palette drops unavailable entries); returning an empty list here
// would keep them hidden after the mode is switched on.
import { Inbox, Mail, MessageCircleQuestion } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { jumpToOldestWaitingChat } from './decision-inbox-actions'
import { forkDecisionInboxAvailable, openForkDecisionInbox } from './decision-inbox-store'
import { forkLettersAvailable, openForkLetters } from '../letters/board-store'

function availability(): ReturnType<CmdJQuickAction['isAvailable']> {
  return forkDecisionInboxAvailable()
    ? { available: true }
    : { available: false, reason: 'client-action-unsupported' }
}

export function getForkDecisionInboxQuickActions(): CmdJQuickAction[] {
  const openTitle = translate('fork.decisionInbox.palette', 'Decision inbox...')
  const oldestTitle = translate(
    'fork.decisionInbox.paletteOldest',
    'Go to the chat waiting on me longest'
  )
  return [
    {
      id: 'fork-decision-inbox',
      kind: 'action',
      title: openTitle,
      description: translate(
        'fork.decisionInbox.paletteDescription',
        'See every chat waiting on you and answer in place'
      ),
      icon: Inbox,
      verbKeywords: [
        openTitle,
        translate('fork.decisionInbox.keywordInbox', 'inbox'),
        translate('fork.decisionInbox.keywordWaiting', 'waiting on me'),
        translate('fork.decisionInbox.keywordQuestions', 'questions')
      ],
      isAvailable: availability,
      run: async () => {
        if (!forkDecisionInboxAvailable()) {
          return { status: 'unavailable', reason: 'client-action-unsupported' }
        }
        openForkDecisionInbox()
        return { status: 'ok' }
      }
    },
    {
      id: 'fork-decision-inbox-oldest',
      kind: 'action',
      title: oldestTitle,
      description: translate(
        'fork.decisionInbox.paletteOldestDescription',
        'Open the chat that has waited on your answer the longest'
      ),
      icon: MessageCircleQuestion,
      verbKeywords: [
        oldestTitle,
        translate('fork.decisionInbox.keywordOldest', 'oldest waiting chat'),
        translate('fork.decisionInbox.keywordNext', 'next decision')
      ],
      isAvailable: availability,
      run: async () => {
        if (!forkDecisionInboxAvailable()) {
          return { status: 'unavailable', reason: 'client-action-unsupported' }
        }
        await jumpToOldestWaitingChat()
        return { status: 'ok' }
      }
    },
    // SLRM-2389: the letters history (FORK.md "Letters and the board").
    {
      id: 'fork-letters',
      kind: 'action',
      title: translate('fork.letters.palette', 'Letters between chats...'),
      description: translate(
        'fork.letters.paletteDescription',
        'See the messages chats sent each other, per chat'
      ),
      icon: Mail,
      verbKeywords: [
        translate('fork.letters.keywordLetters', 'letters'),
        translate('fork.letters.keywordMessages', 'messages between chats')
      ],
      isAvailable: () =>
        forkLettersAvailable()
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        if (!forkLettersAvailable()) {
          return { status: 'unavailable', reason: 'client-action-unsupported' }
        }
        openForkLetters(null)
        return { status: 'ok' }
      }
    }
  ]
}
