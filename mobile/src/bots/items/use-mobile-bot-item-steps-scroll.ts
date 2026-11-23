// Fork BAD-762: the phone page opens at the top, so a set of steps inside an ask's card far down the
// Activity would start out of sight. Once the item is read, the first step still to do scrolls into view.
import { useEffect, useRef } from 'react'
import type { HostInstance, ScrollViewInstance } from 'react-native'

export function useMobileBotItemStepsScroll({
  scroll,
  /** The steps set's id while its steps sit in the ask's card; null otherwise. */
  inAskSet,
  ready
}: {
  scroll: React.RefObject<ScrollViewInstance | null>
  inAskSet: string | null
  ready: boolean
}): { currentStep: React.RefObject<HostInstance | null>; reveal: (animated: boolean) => void } {
  const currentStep = useRef<HostInstance | null>(null)
  const shownFor = useRef<string | null>(null)
  const reveal = (animated: boolean): void => {
    const inner = scroll.current?.getInnerViewRef()
    if (!inner || !currentStep.current) {
      return
    }
    currentStep.current.measureLayout(
      inner,
      (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated }),
      () => {}
    )
  }
  useEffect(() => {
    if (!ready || inAskSet === null || shownFor.current === inAskSet) {
      return
    }
    shownFor.current = inAskSet
    // After the cards have laid out.
    const timer = setTimeout(() => reveal(false), 60)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, inAskSet])
  return { currentStep, reveal }
}
