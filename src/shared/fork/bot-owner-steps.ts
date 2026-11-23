// Owner steps (FORK.md, BAD-747): the settings. Pure.

export type ForkBotOwnerStepsSettings = {
  /** Fork (BAD-747): keep the ordered steps an agent sets on an item as a checklist for you, with Copy, Done and Did not work; unset is on. Off: steps are written into the comment as a numbered list instead. */
  forkBotOwnerSteps?: boolean
  /** Fork (BAD-747): a step with a command can open a terminal on its computer with the command typed in, never run; unset is on. */
  forkBotOwnerStepsOpenInTerminal?: boolean
  /** Fork (BAD-747): when you tick the last step, answer the item's ask as done if one of its options plainly says so; unset is on. */
  forkBotOwnerStepsAutoAnswer?: boolean
}

type Source = Partial<Record<keyof ForkBotOwnerStepsSettings, unknown>> | null | undefined

export function readForkBotOwnerSteps(source: Source): boolean {
  return source?.forkBotOwnerSteps !== false
}

export function readForkBotOwnerStepsOpenInTerminal(source: Source): boolean {
  return source?.forkBotOwnerStepsOpenInTerminal !== false
}

export function readForkBotOwnerStepsAutoAnswer(source: Source): boolean {
  return source?.forkBotOwnerStepsAutoAnswer !== false
}
