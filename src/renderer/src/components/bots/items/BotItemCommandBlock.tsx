// Fork BAD-747: a command as plain, selectable text in a monospace block that wraps, with its Copy always
// showing (touch or pointer). The text is one text node: never turned into links, so selecting it
// selects the command whole.
import { NativeChatCopyButton } from '../../native-chat/messages/actions/NativeChatCopyButton'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'

export function BotItemCommandBlock({
  command,
  kind = 'command',
  className
}: {
  command: string
  /** `text` is words to copy and paste elsewhere (a chat message): the same block, labelled for text. */
  kind?: 'command' | 'text'
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      data-bot-item-command={kind === 'command' ? '' : undefined}
      data-bot-item-text={kind === 'text' ? '' : undefined}
      className={cn(
        'relative min-w-0 max-w-full rounded-md border border-border bg-accent/50',
        className
      )}
    >
      <pre className="m-0 select-text whitespace-pre-wrap px-2.5 py-2 pr-9 font-mono text-[12px] leading-[17px] text-foreground [overflow-wrap:anywhere]">
        {command}
      </pre>
      <NativeChatCopyButton
        text={command}
        label={
          kind === 'text'
            ? t('bots.items.steps.copyText', 'Copy text')
            : t('bots.items.steps.copy', 'Copy command')
        }
        className="absolute right-1 top-1"
      />
    </div>
  )
}
