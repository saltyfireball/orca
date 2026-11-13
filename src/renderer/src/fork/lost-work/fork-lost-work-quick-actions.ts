// SLRM-2096 (FORK.md "Lost work"): the command palette entry that opens the Lost work list.
// Spread into the stock catalog.
import { LifeBuoy } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { forkLostWorkAvailable, openForkLostWork } from './ForkLostWorkHost'

export function getForkLostWorkQuickActions(): CmdJQuickAction[] {
  const title = translate('fork.lostWork.palette', 'Lost work')
  return [
    {
      id: 'fork-lost-work',
      kind: 'action',
      title,
      description: translate(
        'fork.lostWork.paletteDescription',
        'Find unmerged, unpushed and uncommitted work across your projects'
      ),
      icon: LifeBuoy,
      verbKeywords: [
        title,
        translate('fork.lostWork.keywordUnmerged', 'unmerged work'),
        translate('fork.lostWork.keywordStash', 'stashes'),
        translate('fork.lostWork.keywordUnpushed', 'unpushed branches')
      ],
      isAvailable: () =>
        forkLostWorkAvailable()
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        openForkLostWork()
        return { status: 'ok' }
      }
    }
  ]
}
