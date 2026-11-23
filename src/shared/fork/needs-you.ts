// Needs you (FORK.md "Needs you list", BAD-759): one quick list of everything that waits on the
// owner, opened from anywhere. Pure: the settings.

export type ForkNeedsYouSettings = {
  /** Fork (BAD-759): the Needs you list (shortcut, status bar control, palette entries) over the Decision inbox's data; the sidebar's inbox icon folds into it; unset is on. */
  forkNeedsYou?: boolean
  /** Fork (BAD-759): quick answer buttons and a text answer on an ask in the Needs you list; unset is on. */
  forkNeedsYouQuickAnswers?: boolean
}

export type ForkNeedsYouConfig = { enabled: boolean; quickAnswers: boolean }

export function readForkNeedsYouSettings(
  source: Partial<Record<keyof ForkNeedsYouSettings, unknown>> | null | undefined
): ForkNeedsYouConfig {
  return {
    enabled: source?.forkNeedsYou !== false,
    quickAnswers: source?.forkNeedsYouQuickAnswers !== false
  }
}
