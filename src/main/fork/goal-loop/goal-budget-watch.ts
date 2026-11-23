// Goal loop (BAD-682, BAD-766, FORK.md "Goal loop"): whether some active goal has a --budget, so
// the agent guards read terminal agents' spend for it even when no spend cap is set. A small
// module of its own so the guards service need not import the loop's live wiring.
let watching: () => boolean = () => false

/** The goal loop's live wiring says whether an active goal has a budget. */
export function setForkGoalBudgetWatch(read: () => boolean): void {
  watching = read
}

export function forkGoalBudgetWatched(): boolean {
  try {
    return watching()
  } catch {
    return false
  }
}
