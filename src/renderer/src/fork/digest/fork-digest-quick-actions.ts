// Digest (SLRM-2388, FORK.md): the command palette entry that opens the digest. Spread into the
// usage report's palette entries, so no upstream file changes for it.
import { Newspaper } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { openForkDigest } from './use-fork-digest'

export function getForkDigestQuickActions(): CmdJQuickAction[] {
  const title = translate('fork.digest.palette', 'Digest')
  return [
    {
      id: 'fork-digest',
      kind: 'action',
      title,
      description: translate(
        'fork.digest.paletteDescription',
        'What finished, failed, merged and cost, and what waits on you, across your servers'
      ),
      icon: Newspaper,
      verbKeywords: [
        title,
        translate('fork.digest.keywordOvernight', 'overnight'),
        translate('fork.digest.keywordSummary', 'summary')
      ],
      isAvailable: () =>
        window.api?.forkUsageLedger
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        openForkDigest()
        return { status: 'ok' }
      }
    }
  ]
}
