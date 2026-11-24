import { ChevronDown } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'

// Split from NativeChatApprovalCard.tsx (fork BAD-804) to keep the card under the max-lines limit.
export function NativeChatApprovalDetailsToggle({
  open,
  onToggle
}: {
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium text-chat-foreground-faint transition-colors hover:bg-chat-foreground/5 hover:text-chat-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t('components.native-chat.notices.details', 'Details')}
      <ChevronDown className={cn('size-3.5', open && 'rotate-180')} aria-hidden />
    </button>
  )
}
