// Fork BAD-762: brings the current owner step (the first not done) into view in the item's scroller.
// On open the pane sits at the ask at the bottom; when the ask's card is taller than the pane, the
// bottom shows the question and not the steps, so the first step still to do is put at the top instead.
const CURRENT_STEP = '[data-bot-item-step][data-current]'
const ASK_CARD = '[data-bot-item-comment-id]'

function motionOk(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function revealCurrentBotItemStep(
  scroller: HTMLElement | null | undefined,
  mode: 'on-open' | 'on-click'
): void {
  const step = scroller?.querySelector<HTMLElement>(CURRENT_STEP)
  if (!scroller || !step) {
    return
  }
  if (mode === 'on-open') {
    const card = step.closest<HTMLElement>(ASK_CARD)
    const header = Number.parseFloat(scroller.style.scrollPaddingTop) || 0
    // A card that fits the pane shows whole at the bottom: leave the scroll where it is.
    if (!card || card.offsetHeight <= scroller.clientHeight - header) {
      return
    }
  }
  step.scrollIntoView({
    block: 'start',
    behavior: mode === 'on-click' && motionOk() ? 'smooth' : 'auto'
  })
}
