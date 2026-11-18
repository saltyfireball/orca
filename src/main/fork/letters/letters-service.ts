// Letters (FORK.md, SLRM-2389): send, take from a paired host, list. A letter to a chat here is
// queued and the delivery pass types it in between the recipient's turns. A letter to a chat on a
// paired server (`host`) is handed to that server's own RPC at once, signed by this host. A chat
// here may answer a chat on a paired device that wrote to it: that letter waits until the device
// collects it. Every write is rate-limited per sending chat.
import {
  FORK_LETTER_MAX_CHARS,
  FORK_LETTER_QUEUE_PER_CHAT,
  forkLetterInvolves,
  forkLetterRateRefusal,
  letterPartyKey,
  pruneForkLetterSent,
  sameLetterParty,
  type ForkLetter,
  type ForkLetterParty
} from '../../../shared/fork/letters'
import { cleanForkLetterText, forkLetterBodyRefusal } from '../../../shared/fork/letters-frame'
import type {
  ForkLettersDeliverRequest,
  ForkLettersListResult,
  ForkLettersSendRequest
} from '../../../shared/fork/letters-wire'
import { forkLetterDeviceParty, type ForkLettersCaller, type ForkLettersDeps } from './letters-deps'
import {
  forkLetterPartyOf,
  resolveForkLetterCaller,
  resolveForkLetterRecipient
} from './letters-parties'
import { forwardForkLetter } from './letters-peers'
import type { ForkLettersState } from './letters-store'

export function requireForkLetters(deps: ForkLettersDeps): void {
  if (!deps.settings().letters) {
    throw new Error('Letters are off on this host. Turn them on in Settings > Blackfish > Chats.')
  }
}

/** The sending party, or an error for a caller that may not send. */
export async function forkLetterSender(
  deps: ForkLettersDeps,
  caller: ForkLettersCaller
): Promise<ForkLetterParty> {
  if (caller.via === 'paired') {
    return forkLetterDeviceParty(caller.deviceId)
  }
  if (caller.via === 'window') {
    return resolveForkLetterCaller(undefined, [], () => false)
  }
  return resolveForkLetterCaller(caller.claim, await deps.chats(), deps.hasChatRecord)
}

export function cleanForkLetterBody(text: string): string {
  const body = cleanForkLetterText(text, FORK_LETTER_MAX_CHARS)
  if (!body) {
    throw new Error('The letter is empty.')
  }
  const refusal = forkLetterBodyRefusal(body)
  if (refusal) {
    throw new Error(`The letter was not sent: ${refusal}`)
  }
  return body
}

/** A chat on a paired device that wrote to this host: answers to it wait for the device. */
function deviceRecipient(state: ForkLettersState, query: string): ForkLetterParty | null {
  const parties = new Map<string, ForkLetterParty>()
  for (const letter of state.letters) {
    if (letter.from.host?.kind === 'device' && letter.from.kind !== 'shell') {
      parties.set(letterPartyKey(letter.from), letter.from)
    }
  }
  const all = [...parties.values()]
  const exact = all.filter((party) => party.chatId === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? all.filter((p) => p.chatId.startsWith(query))
        : []
  return matches.length === 1 ? matches[0] : null
}

/** Checks the cite, the queue and the rate, then adds the letter and counts it. */
export function admitForkLetter(
  deps: ForkLettersDeps,
  state: ForkLettersState,
  letter: ForkLetter
): ForkLettersState {
  if (sameLetterParty(letter.from, letter.to)) {
    throw new Error('A chat cannot write to itself.')
  }
  if (letter.cite) {
    const cited = state.letters.find((other) => other.id === letter.cite)
    const between =
      cited &&
      ((sameLetterParty(cited.from, letter.from) && sameLetterParty(cited.to, letter.to)) ||
        (sameLetterParty(cited.from, letter.to) && sameLetterParty(cited.to, letter.from)))
    if (!between) {
      throw new Error(
        `Letter ${letter.cite} is not one between these two chats, so it cannot be cited.`
      )
    }
  }
  const waiting = state.letters.filter(
    (other) =>
      (other.state === 'queued' || other.state === 'pickup') && sameLetterParty(other.to, letter.to)
  ).length
  if (waiting >= FORK_LETTER_QUEUE_PER_CHAT) {
    throw new Error(
      `That chat already has ${waiting} letters waiting; send again once it has read them.`
    )
  }
  const config = deps.settings()
  const now = deps.now()
  const from = letterPartyKey(letter.from)
  const to = letterPartyKey(letter.to)
  const refusal = forkLetterRateRefusal(state.sent, from, to, config, now)
  if (refusal) {
    throw new Error(`The letter was not sent: ${refusal}.`)
  }
  return {
    ...state,
    letters: [...state.letters, letter],
    sent: [...pruneForkLetterSent(state.sent, config.windowMs, now), { at: now, from, to }]
  }
}

function newLetter(
  deps: ForkLettersDeps,
  from: ForkLetterParty,
  to: ForkLetterParty,
  text: string,
  cite: string | undefined,
  id = deps.newId()
): ForkLetter {
  return {
    id,
    from,
    to,
    text,
    cite: cite ?? null,
    at: deps.now(),
    state: to.host?.kind === 'device' ? 'pickup' : 'queued',
    settledAt: null,
    note: null,
    tries: 0
  }
}

export async function sendForkLetter(
  deps: ForkLettersDeps,
  request: ForkLettersSendRequest,
  caller: ForkLettersCaller
): Promise<ForkLetter> {
  requireForkLetters(deps)
  if (caller.via === 'paired' && !deps.settings().fromPaired) {
    throw new Error('This host takes no letters from paired devices.')
  }
  const from = await forkLetterSender(deps, caller)
  const text = cleanForkLetterBody(request.text)
  if (request.host) {
    if (caller.via === 'paired') {
      throw new Error('A paired device cannot hand a letter on to another host.')
    }
    return forwardForkLetter(deps, from, request.host, request.to, text, request.cite)
  }
  const chats = await deps.chats()
  const letter = await deps.store.update((state) => {
    let to: ForkLetterParty | null = null
    try {
      to = forkLetterPartyOf(resolveForkLetterRecipient(request.to, chats))
    } catch (error) {
      to = deviceRecipient(state, request.to)
      if (!to) {
        throw error
      }
    }
    const made = newLetter(deps, from, to, text, request.cite)
    return { next: admitForkLetter(deps, state, made), result: made }
  })
  deps.kick()
  return letter
}

/** A paired device hands this host a letter for one of its chats. */
export async function receiveForkLetter(
  deps: ForkLettersDeps,
  request: ForkLettersDeliverRequest,
  deviceId: string
): Promise<ForkLetter> {
  requireForkLetters(deps)
  if (!deps.settings().fromPaired) {
    throw new Error('This host takes no letters from paired devices.')
  }
  const text = cleanForkLetterBody(request.text)
  const from: ForkLetterParty = {
    chatId: request.from.chatId,
    kind: request.from.kind,
    title: request.from.title,
    agent: request.from.agent,
    worktreeId: null,
    host: {
      kind: 'device',
      id: deviceId,
      name: cleanForkLetterText(request.hostName, 80) || 'paired device'
    }
  }
  const to = forkLetterPartyOf(resolveForkLetterRecipient(request.to, await deps.chats()))
  const letter = await deps.store.update((state) => {
    const id = state.letters.some((other) => other.id === request.id) ? deps.newId() : request.id
    const made = newLetter(deps, from, to, text, request.cite, id)
    return { next: admitForkLetter(deps, state, made), result: made }
  })
  deps.kick()
  return letter
}

/** The letters a paired device's chats are owed; each is handed over once. */
export async function collectForkLetters(
  deps: ForkLettersDeps,
  deviceId: string
): Promise<ForkLetter[]> {
  return deps.store.update((state) => {
    const mine = (letter: ForkLetter): boolean =>
      letter.state === 'pickup' &&
      letter.to.host?.kind === 'device' &&
      letter.to.host.id === deviceId
    const taken = state.letters.filter(mine).slice(0, 50)
    if (taken.length === 0) {
      return { result: [] }
    }
    const ids = new Set(taken.map((letter) => letter.id))
    const now = deps.now()
    const letters = state.letters.map((letter) =>
      ids.has(letter.id) ? { ...letter, state: 'forwarded' as const, settledAt: now } : letter
    )
    return { next: { ...state, letters }, result: taken }
  })
}

export async function listForkLetters(
  deps: ForkLettersDeps,
  chat: string | undefined,
  limit = 100
): Promise<ForkLettersListResult> {
  const state = await deps.store.read()
  const letters = chat
    ? state.letters.filter((letter) => forkLetterInvolves(letter, chat))
    : state.letters
  return { now: deps.now(), letters: letters.slice(-limit).toReversed() }
}
