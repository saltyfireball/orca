import { useEffect, useEffectEvent, useState } from 'react'
import type { ForkUpdateInstallWait } from '../../../../shared/fork/update-install-wait'

/**
 * The restart guard's update wait (SLRM-1569), or null when no update install is waiting.
 * `onReleased` runs when the guard drops the install without running it (Cancel, Stop Waiting).
 */
export function useForkUpdateInstallWait(onReleased: () => void): ForkUpdateInstallWait | null {
  const [wait, setWait] = useState<ForkUpdateInstallWait | null>(null)
  const [, setReleases] = useState(0)
  // An effect event always runs the latest `onReleased` without re-subscribing.
  const handleReleased = useEffectEvent(() => {
    onReleased()
    // The caller's reset lives in a ref; re-render so the card shows it.
    setReleases((count) => count + 1)
  })

  useEffect(() => {
    const bridge = window.api.forkUpdateInstallWait
    if (!bridge) {
      return
    }
    let pushed = false
    let live = true
    const offChanged = bridge.onChanged((next) => {
      pushed = true
      setWait(next)
    })
    const offReleased = bridge.onReleased(() => handleReleased())
    void bridge
      .get()
      .then((current) => {
        // A push that arrived first is newer than this answer.
        if (live && !pushed) {
          setWait(current)
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
      offChanged()
      offReleased()
    }
  }, [])

  return wait
}
