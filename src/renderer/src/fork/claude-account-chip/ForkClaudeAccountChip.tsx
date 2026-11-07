// SLRM-1503: a small dot and label naming the Claude account a session runs on.
import React from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { InlineUsageBars } from '@/components/status-bar/InlineProviderUsage'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  SYSTEM_DEFAULT_ACCOUNT_ID,
  type ForkClaudeAccount,
  type ForkClaudeAccountResolution
} from './claude-account-identity'
import { useForkClaudeAccountUsage } from './claude-account-usage'

const UNKNOWN_COLOUR = 'var(--muted-foreground)'
const MAX_MIXED_DOTS = 3

export type ForkClaudeAccountChipProps = {
  resolution: ForkClaudeAccountResolution
  className?: string
  /**
   * Called when the chip is clicked. When set (or `menu` is), clicks stop at the chip so the
   * row or tab under it is not activated or dragged.
   */
  onOpenMenu?: (resolution: ForkClaudeAccountResolution) => void
  /**
   * Wraps the chip in a menu: render the element it is given as a DropdownMenuTrigger's
   * `asChild` child. That element is the chip's hover trigger, which forwards ref and props
   * to the chip's button, so the hover and the menu share one button.
   */
  menu?: (chip: React.ReactElement) => React.ReactNode
}

/** The label without its ` @ host` suffix, for the left side of `A -> B @ kif`. */
function bareLabel(account: ForkClaudeAccount): string {
  const suffix = account.hostLabel ? ` @ ${account.hostLabel}` : ''
  return suffix && account.label.endsWith(suffix)
    ? account.label.slice(0, -suffix.length)
    : account.label
}

function chipLabel(resolution: ForkClaudeAccountResolution): string {
  if (resolution.kind === 'account') {
    return resolution.movingTo
      ? `${bareLabel(resolution.account)} -> ${resolution.movingTo.label}`
      : resolution.account.label
  }
  if (resolution.kind === 'mixed') {
    return translate('fork.accountChip.mixed', 'Mixed')
  }
  const unknown = translate('fork.accountChip.unknownShort', '?')
  return resolution.kind === 'unknown' && resolution.hostLabel
    ? `${unknown} @ ${resolution.hostLabel}`
    : unknown
}

function chipColours(resolution: ForkClaudeAccountResolution): string[] {
  if (resolution.kind === 'account') {
    return resolution.movingTo
      ? [resolution.account.colour, resolution.movingTo.colour]
      : [resolution.account.colour]
  }
  if (resolution.kind === 'mixed') {
    return resolution.accounts.slice(0, MAX_MIXED_DOTS).map((account) => account.colour)
  }
  return [UNKNOWN_COLOUR]
}

function accountName(account: ForkClaudeAccount): string {
  if (account.email) {
    return account.email
  }
  return account.id === SYSTEM_DEFAULT_ACCOUNT_ID
    ? translate('fork.accountChip.systemDefault', 'System default')
    : translate('fork.accountChip.unnamed', 'Claude account')
}

function AccountUsageRow({
  account,
  refreshKey
}: {
  account: ForkClaudeAccount
  refreshKey: number
}): React.JSX.Element {
  const usage = useForkClaudeAccountUsage(account)
  const { refresh } = usage
  React.useEffect(() => {
    if (refreshKey > 0) {
      refresh()
    }
  }, [refreshKey, refresh])
  return (
    <div className="space-y-1" data-testid="fork-account-chip-account">
      <div className="flex items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: account.colour }}
        />
        <span className="truncate font-medium">{accountName(account)}</span>
      </div>
      {account.hostLabel ? (
        <div className="text-muted-foreground">
          {translate('fork.accountChip.onHost', 'On {{value0}}', {
            value0: account.hostLabel
          })}
        </div>
      ) : null}
      {usage.limits ? (
        <InlineUsageBars limits={usage.limits} isFetching={usage.isFetching} />
      ) : (
        <div className="text-muted-foreground">
          {translate('fork.accountChip.noUsage', 'No usage reading for this account yet.')}
        </div>
      )}
    </div>
  )
}

function ChipHover({
  resolution,
  refreshKey
}: {
  resolution: ForkClaudeAccountResolution
  refreshKey: number
}): React.JSX.Element {
  if (resolution.kind === 'unknown') {
    return (
      <div className="text-muted-foreground">
        {translate(
          'fork.accountChip.unknown',
          'This Claude session runs in a folder that is not one of the saved accounts.'
        )}
      </div>
    )
  }
  const movingTo = resolution.kind === 'account' ? resolution.movingTo : undefined
  const accounts =
    resolution.kind === 'mixed'
      ? resolution.accounts
      : resolution.kind === 'account'
        ? [resolution.account, ...(movingTo ? [movingTo] : [])]
        : []
  return (
    <div className="space-y-3">
      {resolution.kind === 'mixed' ? (
        <div className="text-muted-foreground">
          {translate('fork.accountChip.mixedHelp', 'Sessions here run on different accounts.')}
        </div>
      ) : null}
      {movingTo ? (
        <div className="text-muted-foreground">
          {translate(
            'fork.accountChip.movingHelp',
            'Moves to {{value0}} when the current turn ends.',
            { value0: accountName(movingTo) }
          )}
        </div>
      ) : null}
      {accounts.map((account) => (
        <AccountUsageRow
          key={`${account.ownerKey}|${account.id}`}
          account={account}
          refreshKey={refreshKey}
        />
      ))}
    </div>
  )
}

/** Draws nothing for `none`: not Claude, chips switched off, or one account on the host. */
export function ForkClaudeAccountChip({
  resolution,
  className,
  onOpenMenu,
  menu
}: ForkClaudeAccountChipProps): React.JSX.Element | null {
  const [refreshKey, setRefreshKey] = React.useState(0)
  if (resolution.kind === 'none') {
    return null
  }
  const interactive = !!onOpenMenu || !!menu
  const label = chipLabel(resolution)
  const stop = (event: React.SyntheticEvent): void => {
    if (interactive) {
      event.stopPropagation()
    }
  }
  const chip = (
    <button
      type="button"
      data-testid="fork-account-chip"
      data-kind={resolution.kind}
      aria-label={translate('fork.accountChip.ariaLabel', 'Claude account: {{value0}}', {
        value0: label
      })}
      tabIndex={interactive ? 0 : -1}
      className={cn(
        'inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded px-1 text-[10px] leading-4 text-muted-foreground hover:bg-accent/60',
        !interactive && 'cursor-default',
        className
      )}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={(event) => {
        stop(event)
        onOpenMenu?.(resolution)
      }}
    >
      <span className="inline-flex shrink-0 -space-x-0.5">
        {chipColours(resolution).map((colour, index) => (
          <span
            key={index}
            className="size-1.5 rounded-full ring-1 ring-background"
            style={{ backgroundColor: colour }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
  const trigger = <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
  return (
    <HoverCard
      openDelay={300}
      closeDelay={100}
      onOpenChange={(open) => {
        if (open) {
          setRefreshKey((key) => key + 1)
        }
      }}
    >
      {menu ? menu(trigger) : trigger}
      <HoverCardContent variant="workspace-details" align="start">
        <ChipHover resolution={resolution} refreshKey={refreshKey} />
      </HoverCardContent>
    </HoverCard>
  )
}
