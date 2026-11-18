// Best of N (FORK.md, SLRM-2393): the command palette entry that opens the compare view. Spread
// into the stock catalog.
import { Columns3 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { readForkBestOfSettings } from '../../../../shared/fork/best-of/best-of'
import { useAppStore } from '@/store'
import { forkBestOfAvailable } from './best-of-client'
import { openForkBestOf } from './use-fork-best-of'

export function getForkBestOfQuickActions(): CmdJQuickAction[] {
  const title = translate('fork.bestOf.palette', 'Best of N')
  return [
    {
      id: 'fork-best-of',
      kind: 'action',
      title,
      description: translate(
        'fork.bestOf.paletteDescription',
        'Compare the attempts of a best-of run and keep one'
      ),
      icon: Columns3,
      verbKeywords: [
        title,
        translate('fork.bestOf.keywordCompare', 'compare'),
        translate('fork.bestOf.keywordAttempts', 'attempts'),
        translate('fork.bestOf.keywordPick', 'pick')
      ],
      isAvailable: () =>
        forkBestOfAvailable() && readForkBestOfSettings(useAppStore.getState().settings).enabled
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        openForkBestOf()
        return { status: 'ok' }
      }
    }
  ]
}
