// SLRM-2098 (FORK.md "Agent launch queue"): the one seam a memory guard plugs into. While it
// answers `hold: true`, new launches queue even with free slots (waking an existing chat still
// follows the resume setting). Nothing here measures memory; the default never holds.
export type LaunchHoldVerdict = { hold: boolean; reason?: string }

let holdReader: () => LaunchHoldVerdict = () => ({ hold: false })

export function shouldHoldLaunches(): LaunchHoldVerdict {
  try {
    return holdReader()
  } catch {
    // A failing guard never blocks launches.
    return { hold: false }
  }
}

/** Install the guard; pass null to go back to never holding. Call `notifyLaunchHoldChanged` when it lifts. */
export function setLaunchHoldReader(reader: (() => LaunchHoldVerdict) | null): void {
  holdReader = reader ?? (() => ({ hold: false }))
}

let holdChanged: () => void = () => {}

/** The guard calls this when its verdict changes so waiting launches start without a poll. */
export function notifyLaunchHoldChanged(): void {
  holdChanged()
}

export function onLaunchHoldChanged(listener: () => void): void {
  holdChanged = listener
}
