// The board (FORK.md, SLRM-2389): typed asks agents file for the user. REVIEW: look at
// something. DECIDE: pick between options. DO: an act only the user can do. An ask is shown above
// its chat's composer and in the Decision inbox until the user marks it done or throws it back
// with a note; a throw-back is delivered to the asking chat like a letter, between its turns.
// Filing counts against the sender's letter rate, and a chat holds at most a few open asks.
import {
  FORK_BOARD_BODY_MAX_CHARS,
  FORK_BOARD_NOTE_MAX_CHARS,
  FORK_BOARD_TITLE_MAX_CHARS,
  findForkLetterItem,
  forkLetterRateRefusal,
  letterPartyKey,
  pruneForkLetterSent,
  sameLetterParty,
  type ForkBoardAsk,
  type ForkLetter
} from '../../../shared/fork/letters'
import {
  buildForkBoardThrowBack,
  cleanForkLetterText,
  forkLetterBodyRefusal
} from '../../../shared/fork/letters-frame'
import type {
  ForkBoardAddRequest,
  ForkBoardCloseRequest,
  ForkBoardListResult
} from '../../../shared/fork/letters-wire'
import type { ForkLettersCaller, ForkLettersDeps } from './letters-deps'
import { forkLetterSender } from './letters-service'
import { FORK_LETTER_SHELL_PARTY } from './letters-parties'

export function requireForkBoard(deps: ForkLettersDeps): void {
  if (!deps.settings().board) {
    throw new Error('The board is off on this host. Turn it on in Settings > Blackfish > Chats.')
  }
}

export async function addForkBoardAsk(
  deps: ForkLettersDeps,
  request: ForkBoardAddRequest,
  caller: ForkLettersCaller
): Promise<ForkBoardAsk> {
  requireForkBoard(deps)
  const from = await forkLetterSender(deps, caller)
  const title = cleanForkLetterText(request.title.replace(/\s+/g, ' '), FORK_BOARD_TITLE_MAX_CHARS)
  if (!title) {
    throw new Error('An ask needs a title.')
  }
  const body = cleanForkLetterText(request.body ?? '', FORK_BOARD_BODY_MAX_CHARS)
  // A thrown-back ask quotes its title to the author, so it may not hold the frame's markers.
  const forged = forkLetterBodyRefusal(title) ?? forkLetterBodyRefusal(body)
  if (forged) {
    throw new Error(`The ask was not filed: ${forged}`)
  }
  const ask = await deps.store.update((state) => {
    const config = deps.settings()
    const now = deps.now()
    const key = letterPartyKey(from)
    const open = state.asks.filter((a) => a.state === 'open' && letterPartyKey(a.from) === key)
    if (from.kind !== 'shell' && open.length >= config.maxOpenPerChat) {
      throw new Error(
        `This chat already has ${open.length} open asks (at most ${config.maxOpenPerChat}); wait for the user to close some.`
      )
    }
    const refusal = forkLetterRateRefusal(state.sent, key, null, config, now)
    if (refusal) {
      throw new Error(`The ask was not filed: ${refusal}.`)
    }
    const made: ForkBoardAsk = {
      id: deps.newId(),
      type: request.type,
      title,
      body,
      from,
      at: now,
      state: 'open',
      closedAt: null,
      closedBy: null,
      note: null
    }
    return {
      next: {
        ...state,
        asks: [...state.asks, made],
        sent: [
          ...pruneForkLetterSent(state.sent, config.windowMs, now),
          { at: now, from: key, to: 'board' }
        ]
      },
      result: made
    }
  })
  return ask
}

export async function listForkBoardAsks(
  deps: ForkLettersDeps,
  all: boolean
): Promise<ForkBoardListResult> {
  const state = await deps.store.read()
  return {
    now: deps.now(),
    asks: all ? [...state.asks] : state.asks.filter((ask) => ask.state === 'open')
  }
}

/**
 * Done: by the user (the window, or a command outside any agent) or the agent that filed it.
 * Throw back: by the user only, with a note the asking chat is told.
 */
export async function closeForkBoardAsk(
  deps: ForkLettersDeps,
  request: ForkBoardCloseRequest,
  caller: ForkLettersCaller
): Promise<ForkBoardAsk> {
  const by = await forkLetterSender(deps, caller)
  const byUser = by.kind === 'shell'
  const note = cleanForkLetterText(request.note ?? '', FORK_BOARD_NOTE_MAX_CHARS)
  if (request.action === 'back') {
    if (!byUser) {
      throw new Error('Only the user throws an ask back; an agent marks its own ask done.')
    }
    if (!note) {
      throw new Error('Say why it goes back: a throw-back needs a note.')
    }
    const refusal = forkLetterBodyRefusal(note)
    if (refusal) {
      throw new Error(`The note was not sent: ${refusal}`)
    }
  }
  const closed = await deps.store.update((state) => {
    const found = findForkLetterItem(state.asks, request.id, 'ask')
    if (!found.ok) {
      throw new Error(found.error)
    }
    const ask = found.item
    if (ask.state !== 'open') {
      throw new Error(`Ask ${ask.id} is already ${ask.state === 'done' ? 'done' : 'thrown back'}.`)
    }
    const author = !byUser && sameLetterParty(by, ask.from)
    if (!byUser && !author) {
      throw new Error('Only the user or the agent that filed it closes an ask.')
    }
    const now = deps.now()
    const next: ForkBoardAsk = {
      ...ask,
      state: request.action === 'done' ? 'done' : 'thrown',
      closedAt: now,
      closedBy: author ? 'author' : 'user',
      note: note || null
    }
    const letters: ForkLetter[] = [...state.letters]
    if (request.action === 'back' && ask.from.kind !== 'shell') {
      letters.push({
        id: deps.newId(),
        from: { ...FORK_LETTER_SHELL_PARTY, chatId: 'board', title: 'board' },
        to: ask.from,
        text: buildForkBoardThrowBack(ask, note, caller.via === 'local' ? 'shell' : caller.via),
        cite: null,
        at: now,
        state: ask.from.host?.kind === 'device' ? 'pickup' : 'queued',
        settledAt: null,
        note: null,
        tries: 0,
        boardBack: true
      })
    }
    return {
      next: { ...state, letters, asks: state.asks.map((a) => (a.id === ask.id ? next : a)) },
      result: next
    }
  })
  deps.kick()
  return closed
}
