// Needs you (FORK.md "Needs you list", BAD-759): the command palette entries that open the list,
// go to the next one that needs the owner, and go back. The stock catalog caches this list per
// language, so the entries are always built and report themselves unavailable while the feature is
// off (the palette drops unavailable entries).
import { ArrowLeft, BellRing, ChevronsRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import {
  needsYouEnabled,
  openNeedsYou,
  readNeedsYouEntries,
  readNeedsYouTrail
} from './needs-you-store'
import { backFromNeedsYou, jumpToNextNeedsYou } from './needs-you-jump'

function availability(): ReturnType<CmdJQuickAction['isAvailable']> {
  return needsYouEnabled()
    ? { available: true }
    : { available: false, reason: 'client-action-unsupported' }
}

export function getForkNeedsYouQuickActions(): CmdJQuickAction[] {
  const openTitle = translate('fork.needsYou.palette', 'Needs you...')
  const nextTitle = translate('fork.needsYou.paletteNext', 'Needs you: go to the next one')
  const backTitle = translate('fork.needsYou.paletteBack', 'Needs you: back to where I was')
  return [
    {
      id: 'fork-needs-you',
      kind: 'action',
      title: openTitle,
      description: translate(
        'fork.needsYou.paletteDescription',
        'Everything that is waiting on you, and a jump to each'
      ),
      icon: BellRing,
      verbKeywords: [
        openTitle,
        translate('fork.needsYou.keywordWaiting', 'waiting on me'),
        translate('fork.needsYou.keywordAsks', 'asks')
      ],
      isAvailable: availability,
      run: async () => {
        if (!needsYouEnabled()) {
          return { status: 'unavailable', reason: 'client-action-unsupported' }
        }
        openNeedsYou()
        return { status: 'ok' }
      }
    },
    {
      id: 'fork-needs-you-next',
      kind: 'action',
      title: nextTitle,
      description: translate(
        'fork.needsYou.paletteNextDescription',
        'Jump to the next bot, chat or agent that needs you'
      ),
      icon: ChevronsRight,
      verbKeywords: [nextTitle, translate('fork.needsYou.keywordNext', 'next ask')],
      isAvailable: availability,
      run: async () => {
        if (!needsYouEnabled()) {
          return { status: 'unavailable', reason: 'client-action-unsupported' }
        }
        await jumpToNextNeedsYou(readNeedsYouEntries())
        return { status: 'ok' }
      }
    },
    {
      id: 'fork-needs-you-back',
      kind: 'action',
      title: backTitle,
      description: translate(
        'fork.needsYou.paletteBackDescription',
        'Return to what you had open before the last Needs you jump'
      ),
      icon: ArrowLeft,
      verbKeywords: [backTitle],
      isAvailable: () =>
        needsYouEnabled() && readNeedsYouTrail().ret
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        backFromNeedsYou()
        return { status: 'ok' }
      }
    }
  ]
}
