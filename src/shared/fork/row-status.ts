// SLRM-2390 (FORK.md "Row status"): what each agent row shows beside its title: the chat's spend
// from the usage ledger, its context size, the workspace's pull request with its check state, and
// an "Ask agent to fix" button when those checks fail. Each part has its own switch.

export type ForkRowStatusSettings = {
  /** Fork (SLRM-2390): a native Claude chat's estimated spend on its agent rows; unset is on. */
  forkRowSpend?: boolean
  /** Fork (SLRM-2390): a native Claude chat's context size on its agent rows; unset is on. */
  forkRowContext?: boolean
  /** Fork (SLRM-2390): the workspace's pull request and its check state on agent rows; unset is on. */
  forkRowPrChip?: boolean
  /** Fork (SLRM-2390): an Ask agent to fix button on agent rows when the pull request's checks fail; unset is on. */
  forkRowFixChecks?: boolean
}

export type ForkRowStatusConfig = {
  spend: boolean
  context: boolean
  pr: boolean
  fix: boolean
}

export function forkRowStatusConfig(
  settings: ForkRowStatusSettings | null | undefined
): ForkRowStatusConfig {
  const pr = settings?.forkRowPrChip !== false
  return {
    spend: settings?.forkRowSpend !== false,
    context: settings?.forkRowContext !== false,
    pr,
    // The button sits on the chip's check state, so it goes with the chip.
    fix: pr && settings?.forkRowFixChecks !== false
  }
}
