// Bot row ask jump (FORK.md "Idle recovery", SLRM-2472): clicking a bot's sidebar row while it has
// items waiting on the owner also shows the first one on its Home tab. Pure: the setting.

export type ForkBotRowAskJumpSettings = {
  /** Fork (SLRM-2472): clicking a bot row that has items waiting on you also opens the first on its Home tab, and a second click the next; unset is on. */
  forkBotRowAskJump?: boolean
}

export function readForkBotRowAskJump(
  source: Partial<Record<keyof ForkBotRowAskJumpSettings, unknown>> | null | undefined
): boolean {
  return source?.forkBotRowAskJump !== false
}
