// Letters (FORK.md, SLRM-2389): one delivery pass. A queued letter goes into its recipient only
// between turns, through idle recovery's guarded send: a native chat that is loaded and not in a
// turn (checked again inside the send), or a terminal agent at an empty prompt with no dialog and
// no draft (checked again right before the first write), and only where the agent, not a shell,
// reads the terminal. One letter per recipient per pass: the next waits for the turn it starts
// to end. A send that failed after it may have arrived counts as delivered, so a letter is never
// typed in twice. While Pause all is engaged (BAD-818) every letter queued here waits with the
// reason as its note and none expires; once released each waits a new day.
import { FORK_LETTER_EXPIRE_MS, type ForkLetter } from '../../../shared/fork/letters'
import { buildForkLetterDelivery } from '../../../shared/fork/letters-frame'
import { PAUSE_ALL_REASON_PREFIX } from '../../../shared/fork/pause-all'
import type { IdleRecoveryPorts } from '../idle-recovery/idle-recovery-ports'
import { forkPauseAllRefusal, isForkPauseAllEngaged } from '../pause-all/pause-all-state'
import type { ForkLettersState, ForkLettersStore } from './letters-store'

export type ForkLetterDeliveryResult = { outcome: 'delivered' } | { outcome: 'held'; note: string }

export async function deliverForkLetter(
  letter: Pick<ForkLetter, 'to'>,
  text: string,
  ports: IdleRecoveryPorts
): Promise<ForkLetterDeliveryResult> {
  const paused = forkPauseAllRefusal()
  if (paused !== null) {
    return { outcome: 'held', note: paused }
  }
  const { chatId } = letter.to
  if (letter.to.kind === 'chat') {
    const facts = ports.chat.read(chatId)
    if (!facts) {
      return { outcome: 'held', note: 'the chat is not on this host' }
    }
    if (!facts.loaded) {
      return { outcome: 'held', note: 'the chat is asleep' }
    }
    if (facts.inTurn) {
      return { outcome: 'held', note: 'the chat is in a turn' }
    }
    const stillIdle = (): boolean => {
      const now = ports.chat.read(chatId)
      return now !== null && now.loaded && !now.inTurn && !isForkPauseAllEngaged()
    }
    const outcome = await ports.chat.send(chatId, text, facts.fence, stillIdle)
    return outcome === 'refused'
      ? { outcome: 'held', note: 'the chat got busy' }
      : { outcome: 'delivered' }
  }
  if (letter.to.kind !== 'terminal') {
    return { outcome: 'held', note: 'nothing to deliver to' }
  }
  const bound = ports.terminal.bind(chatId)
  if (!bound) {
    return { outcome: 'held', note: 'the terminal is not live' }
  }
  const refusal = await ports.terminal.refusal(chatId, bound.handle)
  if (refusal !== null) {
    return { outcome: 'held', note: `the terminal is not at rest (${refusal})` }
  }
  const outcome = await ports.terminal.send(
    bound,
    letter.to.agent,
    text,
    async () =>
      !isForkPauseAllEngaged() && (await ports.terminal.refusal(chatId, bound.handle)) === null
  )
  return outcome === 'refused'
    ? { outcome: 'held', note: 'the terminal got busy' }
    : { outcome: 'delivered' }
}

/** The text typed in: the host's frame around a letter, or a board message as it is. */
export function forkLetterTextFor(letter: ForkLetter, state: ForkLettersState): string {
  if (letter.boardBack) {
    return letter.text
  }
  const cited = letter.cite ? state.letters.find((other) => other.id === letter.cite) : undefined
  return buildForkLetterDelivery(letter, cited?.at ?? null)
}

/** The letters a pass tries: the oldest queued letter of each local recipient. */
export function forkLettersDue(letters: readonly ForkLetter[]): ForkLetter[] {
  const seen = new Set<string>()
  const due: ForkLetter[] = []
  for (const letter of [...letters].sort((a, b) => a.at - b.at)) {
    if (letter.state !== 'queued' || letter.to.host !== null || seen.has(letter.to.chatId)) {
      continue
    }
    seen.add(letter.to.chatId)
    due.push(letter)
  }
  return due
}

const queuedHere = (letter: ForkLetter): boolean =>
  letter.state === 'queued' && letter.to.host === null

/** Pause all (BAD-818): while engaged, each letter queued here notes the reason; once released, a
 *  letter it held drops the note and starts its day again. */
function holdOrRelease(
  state: ForkLettersState,
  now: number,
  paused: string | null
): ForkLettersState | undefined {
  let changed = false
  const letters = state.letters.map((letter): ForkLetter => {
    if (!queuedHere(letter)) {
      return letter
    }
    if (paused !== null && letter.note !== paused) {
      changed = true
      return { ...letter, note: paused }
    }
    if (paused === null && letter.note?.startsWith(PAUSE_ALL_REASON_PREFIX)) {
      changed = true
      return { ...letter, note: null, pauseReleasedAt: now }
    }
    return letter
  })
  return changed ? { ...state, letters } : undefined
}

function expireOld(
  state: ForkLettersState,
  now: number,
  paused: boolean
): ForkLettersState | undefined {
  let changed = false
  const letters = state.letters.map((letter) => {
    const waiting = letter.state === 'queued' || letter.state === 'pickup'
    if (
      !waiting ||
      (paused && queuedHere(letter)) ||
      now - (letter.pauseReleasedAt ?? letter.at) < FORK_LETTER_EXPIRE_MS
    ) {
      return letter
    }
    changed = true
    return {
      ...letter,
      state: 'expired' as const,
      settledAt: now,
      note: letter.note ?? 'not delivered within a day'
    }
  })
  return changed ? { ...state, letters } : undefined
}

/** One pass. Resolves the number of letters still queued here afterwards. */
export async function runForkLetterDeliveryPass(
  store: ForkLettersStore,
  ports: IdleRecoveryPorts,
  now: () => number = Date.now
): Promise<number> {
  const paused = forkPauseAllRefusal()
  const state = await store.update((current) => {
    const at = now()
    const marked = holdOrRelease(current, at, paused)
    const next = expireOld(marked ?? current, at, paused !== null) ?? marked
    return { next, result: next ?? current }
  })
  const results = new Map<string, ForkLetterDeliveryResult>()
  for (const letter of forkLettersDue(state.letters)) {
    try {
      results.set(
        letter.id,
        await deliverForkLetter(letter, forkLetterTextFor(letter, state), ports)
      )
    } catch (error) {
      results.set(letter.id, {
        outcome: 'held',
        note: error instanceof Error ? error.message.slice(0, 200) : 'the send failed'
      })
    }
  }
  return store.update((current) => {
    const at = now()
    let changed = false
    const letters = current.letters.map((letter): ForkLetter => {
      const result = results.get(letter.id)
      // A held letter is written only when what held it changed, so a wait does not churn the disk.
      if (
        !result ||
        letter.state !== 'queued' ||
        (result.outcome === 'held' && result.note === letter.note)
      ) {
        return letter
      }
      changed = true
      return result.outcome === 'delivered'
        ? { ...letter, state: 'delivered', settledAt: at, note: null, tries: letter.tries + 1 }
        : { ...letter, note: result.note, tries: letter.tries + 1 }
    })
    const queued = letters.filter((l) => l.state === 'queued' && l.to.host === null).length
    return { next: changed ? { ...current, letters } : undefined, result: queued }
  })
}
