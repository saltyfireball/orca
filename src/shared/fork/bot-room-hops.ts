// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): how many bot-to-bot hand-offs may
// chain under one person's post in a group room before the room waits for the owner, and (BAD-844)
// how many turns those hand-offs may wake under it in all. Pure: the settings and their reading.

export type ForkBotRoomHopSettings = {
  /** Fork (BAD-801): the longest chain of bot hand-offs (one member's reply naming another, which wakes it) under one person's post in a group room; past it nobody is woken and one Decision inbox entry asks to Continue. 0 is no limit; unset is 6. */
  forkBotRoomHopLimit?: number
  /** Fork (BAD-844): the most bot turns hand-offs may wake in all under one person's post in a group room, however the chains branch; past it nobody is woken and the same Decision inbox entry asks to Continue. 0 is no cap; unset is 24. */
  forkBotRoomTurnCap?: number
}

export const FORK_BOT_ROOM_HOP_DEFAULT_LIMIT = 6
export const FORK_BOT_ROOM_HOP_MAX_LIMIT = 100
export const FORK_BOT_ROOM_HOP_CHOICES = [0, 3, 6, 10, 20] as const

export const FORK_BOT_ROOM_TURN_DEFAULT_CAP = 24
export const FORK_BOT_ROOM_TURN_MAX_CAP = 500
export const FORK_BOT_ROOM_TURN_CHOICES = [0, 12, 24, 50, 100] as const

/** A whole number from 0 to `max` saved under `key`; anything else reads as `fallback`. */
function wholeSetting(settings: unknown, key: string, fallback: number, max: number): number {
  // Read from whatever settings it is given: the runtime's store type does not carry the fork's keys.
  const value: unknown =
    typeof settings === 'object' && settings !== null ? Reflect.get(settings, key) : undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback
}

/** The limit in force: 0 for none; a value that is not a whole number from 0 to the max reads as the default. */
export function forkBotRoomHopLimit(settings: unknown): number {
  return wholeSetting(
    settings,
    'forkBotRoomHopLimit',
    FORK_BOT_ROOM_HOP_DEFAULT_LIMIT,
    FORK_BOT_ROOM_HOP_MAX_LIMIT
  )
}

/** The woken-turn cap in force: 0 for none; as the hop limit, anything else reads as the default. */
export function forkBotRoomTurnCap(settings: unknown): number {
  return wholeSetting(
    settings,
    'forkBotRoomTurnCap',
    FORK_BOT_ROOM_TURN_DEFAULT_CAP,
    FORK_BOT_ROOM_TURN_MAX_CAP
  )
}
