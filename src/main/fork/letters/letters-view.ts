// Letters and the board (FORK.md, SLRM-2389): what the desktop window shows, read from this host
// and from every paired server through its own RPC, so asks filed by agents on a server show up
// here too. A server that does not answer in time is named, and the rest still shows. Keep
// electron out of this file; `letters-ipc.ts` is the window's side.
import type { ForkBoardAsk, ForkLetter } from '../../../shared/fork/letters'
import {
  FORK_LETTERS_METHODS as METHODS,
  type ForkBoardCloseWindowRequest,
  type ForkBoardCloseWindowResult,
  type ForkBoardListResult,
  type ForkBoardView,
  type ForkLettersHistoryView,
  type ForkLettersListResult
} from '../../../shared/fork/letters-wire'
import { closeForkBoardAsk, listForkBoardAsks } from './board-service'
import type { ForkLettersDeps } from './letters-deps'
import { listForkLetters } from './letters-service'

export const FORK_LETTERS_VIEW_TIMEOUT_MS = 4000

type Remote<T> = { env: { id: string; name: string }; value: T | null }

async function fromEveryServer<T>(
  deps: ForkLettersDeps,
  method: string,
  params: unknown
): Promise<Remote<T>[]> {
  let environments: { id: string; name: string }[] = []
  try {
    environments = await deps.environments()
  } catch {
    return []
  }
  return Promise.all(
    environments.map(async (env) => {
      try {
        const value = (await deps.callEnvironment(
          env.id,
          method,
          params,
          FORK_LETTERS_VIEW_TIMEOUT_MS
        )) as T
        return { env, value }
      } catch (error) {
        // A server without letters (stock Orca, an older Blackfish) has nothing to show.
        const code = (error as { code?: unknown } | null)?.code
        return { env, value: code === 'method_not_found' ? ({} as T) : null }
      }
    })
  )
}

const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

export async function forkBoardView(deps: ForkLettersDeps): Promise<ForkBoardView> {
  const local = deps.settings().board ? (await listForkBoardAsks(deps, false)).asks : []
  const remote = await fromEveryServer<ForkBoardListResult>(deps, METHODS.boardList, {})
  const asks: ForkBoardView['asks'] = local.map((ask) => ({ ...ask, source: null }))
  const unreachable: string[] = []
  for (const { env, value } of remote) {
    if (!value) {
      unreachable.push(env.name)
      continue
    }
    for (const ask of asList<ForkBoardAsk>(value.asks)) {
      if (ask?.state === 'open' && typeof ask.id === 'string') {
        asks.push({ ...ask, source: { environmentId: env.id, name: env.name } })
      }
    }
  }
  asks.sort((a, b) => a.at - b.at)
  return { now: deps.now(), asks, unreachable }
}

export async function forkLettersHistory(
  deps: ForkLettersDeps,
  chatId: string | null
): Promise<ForkLettersHistoryView> {
  const params = chatId ? { chat: chatId, limit: 200 } : { limit: 200 }
  const local = (await listForkLetters(deps, params.chat, params.limit)).letters
  const remote = await fromEveryServer<ForkLettersListResult>(deps, METHODS.list, params)
  const letters: ForkLettersHistoryView['letters'] = local.map((letter) => ({
    ...letter,
    source: null
  }))
  const unreachable: string[] = []
  for (const { env, value } of remote) {
    if (!value) {
      unreachable.push(env.name)
      continue
    }
    for (const letter of asList<ForkLetter>(value.letters)) {
      if (typeof letter?.id === 'string' && typeof letter.text === 'string') {
        letters.push({ ...letter, source: { environmentId: env.id, name: env.name } })
      }
    }
  }
  letters.sort((a, b) => b.at - a.at)
  return { now: deps.now(), letters, unreachable }
}

export async function closeForkBoardAskFromWindow(
  deps: ForkLettersDeps,
  request: ForkBoardCloseWindowRequest
): Promise<ForkBoardCloseWindowResult> {
  const note = request.note?.trim() || undefined
  try {
    const params = { id: request.id, action: request.action, ...(note ? { note } : {}) }
    await (request.environmentId
      ? deps.callEnvironment(
          request.environmentId,
          METHODS.boardClose,
          params,
          FORK_LETTERS_VIEW_TIMEOUT_MS
        )
      : closeForkBoardAsk(deps, params, { via: 'window' }))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
