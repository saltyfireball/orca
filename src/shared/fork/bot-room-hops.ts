// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): how many bot-to-bot hand-offs may
// chain under one person's post in a group room before the room waits for the owner. Pure: the
// setting and its reading.

export type ForkBotRoomHopSettings = {
  /** Fork (BAD-801): the longest chain of bot hand-offs (one member's reply naming another, which wakes it) under one person's post in a group room; past it nobody is woken and one Decision inbox entry asks to Continue. 0 is no limit; unset is 6. */
  forkBotRoomHopLimit?: number
}

export const FORK_BOT_ROOM_HOP_DEFAULT_LIMIT = 6
export const FORK_BOT_ROOM_HOP_MAX_LIMIT = 100
export const FORK_BOT_ROOM_HOP_CHOICES = [0, 3, 6, 10, 20] as const

/** The limit in force: 0 for none; a value that is not a whole number from 0 to the max reads as the default. */
export function forkBotRoomHopLimit(settings: unknown): number {
  // Read from whatever settings it is given: the runtime's store type does not carry the fork's keys.
  const value =
    typeof settings === 'object' && settings !== null && 'forkBotRoomHopLimit' in settings
      ? settings.forkBotRoomHopLimit
      : undefined
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= FORK_BOT_ROOM_HOP_MAX_LIMIT
    ? value
    : FORK_BOT_ROOM_HOP_DEFAULT_LIMIT
}
