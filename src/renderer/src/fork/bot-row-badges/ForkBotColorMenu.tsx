// Bot row color picker (FORK.md "Bot row badges and colors"): a Color submenu in a bot row's
// context menu with the palette, a custom color and None. The choice is saved in the fork's
// settings, so it persists and carries no host setting.
import React from 'react'
import { Check, Palette } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { botSidebarEntryKey } from '@/components/bots/bot-sidebar-entry-keys'
import type { Bot } from '../../../../shared/bot-types'
import {
  FORK_BOT_ROW_PALETTE,
  forkBotRowColor,
  forkBotRowColorsWith,
  normalizeForkBotRowColor
} from '../../../../shared/fork/bot-row-badges'

function colorLabel(id: (typeof FORK_BOT_ROW_PALETTE)[number]['id'], t: Translate): string {
  switch (id) {
    case 'red':
      return t('fork.botRowBadges.color.red', 'Red')
    case 'orange':
      return t('fork.botRowBadges.color.orange', 'Orange')
    case 'yellow':
      return t('fork.botRowBadges.color.yellow', 'Yellow')
    case 'green':
      return t('fork.botRowBadges.color.green', 'Green')
    case 'teal':
      return t('fork.botRowBadges.color.teal', 'Teal')
    case 'blue':
      return t('fork.botRowBadges.color.blue', 'Blue')
    case 'purple':
      return t('fork.botRowBadges.color.purple', 'Purple')
    case 'pink':
      return t('fork.botRowBadges.color.pink', 'Pink')
  }
}

const CUSTOM_START = '#3b82f6'

export function ForkBotColorMenu({ bot }: { bot: Bot }): React.JSX.Element {
  const t = useTranslate()
  const key = botSidebarEntryKey(bot)
  const current = useAppStore((s) => forkBotRowColor(s.settings, key))
  const update = useAppStore((s) => s.updateSettings)
  const set = (color: string | null): void => {
    const colors = useAppStore.getState().settings?.forkBotRowColors
    void update({ forkBotRowColors: forkBotRowColorsWith(colors, key, color) })
  }
  const inPalette = FORK_BOT_ROW_PALETTE.some(({ hex }) => hex === current)
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Palette className="size-3.5" />
        {t('fork.botRowBadges.color', 'Color')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        <ContextMenuItem onSelect={() => set(null)}>
          <span aria-hidden className="size-3 rounded-full border border-border" />
          {t('fork.botRowBadges.colorNone', 'None')}
          {current === null ? <Check className="ml-auto size-3.5" /> : null}
        </ContextMenuItem>
        {FORK_BOT_ROW_PALETTE.map(({ id, hex }) => (
          <ContextMenuItem key={id} onSelect={() => set(hex)} data-fork-bot-color-choice={id}>
            <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: hex }} />
            {colorLabel(id, t)}
            {current === hex ? <Check className="ml-auto size-3.5" /> : null}
          </ContextMenuItem>
        ))}
        <ContextMenuItem
          // The native picker opens from the label; the menu stays open until a color is chosen.
          onSelect={(event) => event.preventDefault()}
        >
          <input
            type="color"
            value={normalizeForkBotRowColor(current) ?? CUSTOM_START}
            aria-label={t('fork.botRowBadges.colorCustom', 'Custom color')}
            onChange={(event) => set(event.target.value)}
            className="size-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          {t('fork.botRowBadges.colorCustom', 'Custom color')}
          {current && !inPalette ? <Check className="ml-auto size-3.5" /> : null}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
