// Bot row click (FORK.md "Idle recovery", SLRM-2472, BAD-759): what a click on a bot's sidebar row
// does while the bot has items waiting on the owner. Pure: the setting and its migration.

/** 'list': the bot's Home list, Needs you on top; 'item': the oldest waiting item; 'off': upstream's click only. */
export type ForkBotRowClick = 'list' | 'item' | 'off'

export type ForkBotRowAskJumpSettings = {
  /**
   * Fork (SLRM-2472, BAD-759): what clicking a bot row that has items waiting on you does: 'list' shows its Home list with Needs you at the top (a panel left inside an item goes back to the list), 'item' opens the oldest waiting item on its Home tab (a second click the next), 'off' only opens the bot; unset is 'list'. A saved true means 'item' and false 'off'.
   */
  forkBotRowAskJump?: boolean | ForkBotRowClick
}

export function readForkBotRowClick(
  source: Partial<Record<keyof ForkBotRowAskJumpSettings, unknown>> | null | undefined
): ForkBotRowClick {
  const value = source?.forkBotRowAskJump
  if (value === true || value === 'item') {
    return 'item'
  }
  if (value === false || value === 'off') {
    return 'off'
  }
  return 'list'
}
