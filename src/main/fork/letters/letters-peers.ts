// Letters (FORK.md, SLRM-2389): letters across paired hosts, over each paired server's own RPC
// (the client this desktop already holds). A letter to a chat on a server is handed over at once
// and kept here as forwarded. A server cannot call its desktop, so a server chat's answer waits
// there until this desktop collects it: a desktop polls each server it wrote to in the last day.
import {
  FORK_LETTER_MAX_CHARS,
  forkLetterRateRefusal,
  letterPartyKey,
  pruneForkLetterSent,
  type ForkLetter,
  type ForkLetterParty
} from '../../../shared/fork/letters'
import { cleanForkLetterText, forkLetterBodyRefusal } from '../../../shared/fork/letters-frame'
import {
  FORK_LETTERS_METHODS as METHODS,
  type ForkLettersCollectResult,
  type ForkLettersDeliverRequest,
  type ForkLettersSendResult
} from '../../../shared/fork/letters-wire'
import type { ForkLettersDeps } from './letters-deps'

export const FORK_LETTERS_PEER_TIMEOUT_MS = 8000
/** A server written to within this time is polled for answers. */
export const FORK_LETTERS_PEER_WINDOW_MS = 24 * 60 * 60_000

async function findEnvironment(
  deps: ForkLettersDeps,
  selector: string
): Promise<{ id: string; name: string }> {
  const environments = await deps.environments()
  const found =
    environments.find((env) => env.id === selector) ??
    environments.find((env) => env.name === selector)
  if (!found) {
    throw new Error(`No paired server named "${selector}". Settings > Remote servers lists them.`)
  }
  return found
}

/** Hands one letter to the paired server its recipient lives on; the record stays here too. */
export async function forwardForkLetter(
  deps: ForkLettersDeps,
  from: ForkLetterParty,
  hostSelector: string,
  to: string,
  text: string,
  cite: string | undefined
): Promise<ForkLetter> {
  const env = await findEnvironment(deps, hostSelector)
  const host = { kind: 'environment' as const, id: env.id, name: env.name }
  const id = deps.newId()
  const draft: ForkLetter = {
    id,
    from,
    to: { chatId: to, kind: 'chat', title: '', agent: '', worktreeId: null, host },
    text,
    cite: cite ?? null,
    at: deps.now(),
    state: 'forwarded',
    settledAt: deps.now(),
    note: null,
    tries: 1
  }
  // Count it before the call, so a server that is slow to refuse still costs the sender.
  await deps.store.update((state) => {
    const config = deps.settings()
    const now = deps.now()
    const fromKey = letterPartyKey(from)
    const toKey = letterPartyKey(draft.to)
    const refusal = forkLetterRateRefusal(state.sent, fromKey, toKey, config, now)
    if (refusal) {
      throw new Error(`The letter was not sent: ${refusal}.`)
    }
    return {
      next: {
        ...state,
        sent: [
          ...pruneForkLetterSent(state.sent, config.windowMs, now),
          { at: now, from: fromKey, to: toKey }
        ]
      },
      result: null
    }
  })
  const request: ForkLettersDeliverRequest = {
    id,
    to,
    text,
    ...(cite ? { cite } : {}),
    from: { chatId: from.chatId, kind: from.kind, title: from.title, agent: from.agent },
    hostName: cleanForkLetterText(deps.hostName(), 80)
  }
  let letter: ForkLetter
  try {
    const answer = (await deps.callEnvironment(
      env.id,
      METHODS.deliver,
      request,
      FORK_LETTERS_PEER_TIMEOUT_MS
    )) as Partial<ForkLettersSendResult> | null
    const remote = answer?.letter
    letter = {
      ...draft,
      to: {
        ...draft.to,
        chatId: typeof remote?.to?.chatId === 'string' ? remote.to.chatId : to,
        kind: remote?.to?.kind === 'terminal' ? 'terminal' : 'chat',
        title: typeof remote?.to?.title === 'string' ? remote.to.title.slice(0, 200) : ''
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await deps.store.update((state) => ({
      next: {
        ...state,
        letters: [...state.letters, { ...draft, state: 'failed', note: reason.slice(0, 300) }]
      },
      result: null
    }))
    throw new Error(`${env.name} did not take the letter: ${reason}`)
  }
  await deps.store.update((state) => ({
    next: {
      ...state,
      letters: [...state.letters, letter],
      peers: { ...state.peers, [env.id]: deps.now() }
    },
    result: null
  }))
  deps.kick()
  return letter
}

const str = (value: unknown, max: number): string =>
  typeof value === 'string' ? cleanForkLetterText(value, max) : ''

/**
 * A letter a server handed over, rebuilt field by field: the server is paired, but its chats are
 * other agents, so the body keeps the untrusted frame and a forged marker drops the letter.
 */
export function parseCollectedForkLetter(
  raw: unknown,
  host: { kind: 'environment'; id: string; name: string },
  now: number
): ForkLetter | null {
  const value = (raw ?? {}) as Partial<Record<keyof ForkLetter, unknown>>
  const from = (value.from ?? {}) as Partial<Record<keyof ForkLetterParty, unknown>>
  const to = (value.to ?? {}) as Partial<Record<keyof ForkLetterParty, unknown>>
  const id = str(value.id, 12)
  const text = str(value.text, FORK_LETTER_MAX_CHARS)
  const fromId = str(from.chatId, 512)
  const toId = str(to.chatId, 512)
  if (!/^[a-f0-9]{12}$/.test(id) || !text || !fromId || !toId || forkLetterBodyRefusal(text)) {
    return null
  }
  const kind = (k: unknown): 'chat' | 'terminal' => (k === 'terminal' ? 'terminal' : 'chat')
  const cite = str(value.cite, 12)
  return {
    id,
    from: {
      chatId: fromId,
      kind: kind(from.kind),
      title: str(from.title, 200),
      agent: str(from.agent, 100),
      worktreeId: null,
      host
    },
    to: {
      chatId: toId,
      kind: kind(to.kind),
      title: str(to.title, 200),
      agent: str(to.agent, 100),
      worktreeId: null,
      host: null
    },
    text,
    cite: /^[a-f0-9]{4,12}$/.test(cite) ? cite : null,
    at: now,
    state: 'queued',
    settledAt: null,
    note: null,
    tries: 0
  }
}

/** True when some paired server was written to recently enough to be polled. */
export function forkLettersHavePeers(peers: Record<string, number>, now: number): boolean {
  return Object.values(peers).some((at) => now - at < FORK_LETTERS_PEER_WINDOW_MS)
}

/**
 * Collects the answers waiting on each recent server and queues them here. Resolves true when
 * any arrived. A server that does not answer is tried again on the next poll.
 */
export async function pullForkLettersFromPeers(deps: ForkLettersDeps): Promise<boolean> {
  const state = await deps.store.read()
  const now = deps.now()
  const recent = Object.entries(state.peers).filter(
    ([, at]) => now - at < FORK_LETTERS_PEER_WINDOW_MS
  )
  if (recent.length === 0) {
    return false
  }
  const names = new Map((await deps.environments()).map((env) => [env.id, env.name]))
  let arrived = false
  for (const [envId] of recent) {
    const name = names.get(envId)
    if (!name) {
      continue
    }
    let answer: Partial<ForkLettersCollectResult> | null
    try {
      answer = (await deps.callEnvironment(
        envId,
        METHODS.collect,
        {},
        FORK_LETTERS_PEER_TIMEOUT_MS
      )) as Partial<ForkLettersCollectResult> | null
    } catch {
      continue
    }
    const incoming = Array.isArray(answer?.letters) ? answer.letters : []
    if (incoming.length === 0) {
      continue
    }
    arrived = true
    await deps.store.update((current) => {
      const known = new Set(current.letters.map((letter) => letter.id))
      const host = { kind: 'environment' as const, id: envId, name }
      const added = incoming
        .map((raw) => parseCollectedForkLetter(raw, host, deps.now()))
        .filter((letter): letter is ForkLetter => letter !== null && !known.has(letter.id))
      return { next: { ...current, letters: [...current.letters, ...added] }, result: null }
    })
  }
  if (arrived) {
    deps.kick()
  }
  return arrived
}
