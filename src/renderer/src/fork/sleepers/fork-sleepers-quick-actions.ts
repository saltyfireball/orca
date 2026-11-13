// Sleepers (FORK.md): the command palette entry that opens the Sleepers dialog. Spread into the
// stock catalog with one line.
import { Moon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { openForkSleepersDialog } from './ForkSleepersDialog'

export function getForkSleepersQuickActions(): CmdJQuickAction[] {
  const title = translate('fork.sleepers.palette', 'Sleepers...')
  return [
    {
      id: 'fork-sleepers',
      kind: 'action',
      title,
      description: translate(
        'fork.sleepers.paletteDescription',
        'See every chat and terminal agent; sleep, wake or keep them awake'
      ),
      icon: Moon,
      verbKeywords: [
        title,
        translate('fork.sleepers.keywordSleep', 'sleep chats'),
        translate('fork.sleepers.keywordIdle', 'idle agents'),
        translate('fork.sleepers.keywordMemory', 'free memory')
      ],
      isAvailable: () => ({ available: true }),
      run: async () => {
        openForkSleepersDialog()
        return { status: 'ok' }
      }
    }
  ]
}
