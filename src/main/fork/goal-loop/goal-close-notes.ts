// Goal loop (BAD-822, FORK.md "Goal loop"): the closes a person asked for (a chat tab, a terminal,
// also through the CLI or the phone), told to the goal loop so a closed agent's goal ends quietly.
// No recorded close means the agent was lost. Notes from before the loop starts wait here.
// Keep imports out of this file: runtime close paths load it.
type GoalCloseListener = (ids: string[]) => void

const MAX_EARLY_NOTES = 200
let listener: GoalCloseListener | null = null
let early: string[] = []

/** Chat session ids or terminal pane keys a person closed. */
export function noteForkGoalAgentsClosed(ids: Iterable<string | null | undefined>): void {
  const closed = [...ids].filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (closed.length === 0) {
    return
  }
  if (listener) {
    listener(closed)
    return
  }
  early = [...early, ...closed].slice(-MAX_EARLY_NOTES)
}

export function setForkGoalCloseListener(next: GoalCloseListener): void {
  listener = next
  if (early.length > 0) {
    const held = early
    early = []
    next(held)
  }
}
