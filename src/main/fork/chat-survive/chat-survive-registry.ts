// SLRM-1394: the chat-survive brokers this app instance started, by Orca session id. Each one is
// watched from its spawn on: how much output the app took (for the quit hook's replay mark) and
// whether it is still running. Once the quit hook has handed a broker off (`detached`), nothing in
// this instance may signal it again: its kill does nothing and the managed process stops closing.
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  createChatSurviveStreamTracker,
  type ChatSurviveStreamMark,
  type ChatSurviveStreamTracker
} from './chat-survive-stream-mark'

export type ChatSurviveRecord = {
  v: 1
  sessionId: string | null
  brokerPid: number
  socketPath: string
  token: string
  /** `chatSurviveLaunchHash` of the provider's launch; adoption needs the same one. */
  launch?: string
  /** Written by the quit hook once the broker carries the provider on alone. */
  detached?: ChatSurviveStreamMark & { fence: number }
}

export type ChatSurviveEntry = {
  readonly sessionId: string
  readonly child: ChildProcessWithoutNullStreams
  readonly record: ChatSurviveRecord
  readonly recordPath: string
  readonly tracker: ChatSurviveStreamTracker
  /** The broker refuses a fence at or below the last one it accepted; a hand-off must go higher. */
  readonly fenceFloor: number
  state: 'live' | 'detaching' | 'detached' | 'exited'
}

const bySession = new Map<string, ChatSurviveEntry>()
const byChild = new WeakMap<ChildProcessWithoutNullStreams, ChatSurviveEntry>()

// Every change to one record file runs after the one before it, in call order, so the spawn's
// first write, the quit hook's rewrite and the exit's removal can never land out of order.
const recordChains = new Map<string, Promise<void>>()

function onRecordChain(path: string, change: () => Promise<void>): Promise<void> {
  const run = (recordChains.get(path) ?? Promise.resolve()).then(change)
  const settled = run.catch(() => undefined)
  recordChains.set(path, settled)
  void settled.then(() => {
    if (recordChains.get(path) === settled) {
      recordChains.delete(path)
    }
  })
  return run
}

/**
 * Writes a record whole or not at all, so a reader never sees half of one. With `privateDir`,
 * first makes the record's folder (owner only: tokens live here). Rejects when the write fails.
 */
export function writeChatSurviveRecord(
  path: string,
  record: ChatSurviveRecord,
  options: { privateDir?: boolean } = {}
): Promise<void> {
  return onRecordChain(path, async () => {
    if (options.privateDir) {
      const dir = dirname(path)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      // mkdir leaves the mode of a folder that already exists alone.
      await chmod(dir, 0o700)
    }
    const next = `${path}.next`
    await writeFile(next, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    await rename(next, path)
  })
}

/**
 * Resolves once every record write and removal queued so far has landed or failed; the quit path
 * awaits it so an exit's removal is not lost with the process. Never rejects.
 */
export async function chatSurviveRecordsSettled(): Promise<void> {
  await Promise.all(recordChains.values())
}

/** Removes a record once every earlier write to it has landed. Never rejects. */
export function removeChatSurviveRecord(path: string): Promise<void> {
  return onRecordChain(path, () => rm(path, { force: true })).catch(() => undefined)
}

/** Subscribes alongside the first reader, so watching never starts the stream early. */
function watchWithReader(
  stream: ChildProcessWithoutNullStreams['stdout'],
  onChunk: (chunk: Buffer | string) => void
): void {
  const onSubscribe = (event: string | symbol): void => {
    if (event !== 'data' && event !== 'readable') {
      return
    }
    stream.removeListener('newListener', onSubscribe)
    stream.on('data', onChunk)
  }
  stream.on('newListener', onSubscribe)
}

type Method = (...args: never[]) => unknown

/** Whatever has a method called `name`: a child process or its stdin. */
type MethodOwner<Name extends string, Fn extends Method> = Record<Name, Fn>

/** Replaces one method on its owner, calling through unless `skip` says otherwise. */
function interpose<Name extends string, Fn extends Method>(
  target: MethodOwner<Name, Fn>,
  name: Name,
  before: (args: Parameters<Fn>) => { skip: true; value: unknown } | null
): void {
  const original: Fn = target[name]
  if (typeof original !== 'function') {
    return
  }
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value: (...args: Parameters<Fn>): unknown => {
      const verdict = before(args)
      return verdict ? verdict.value : original.apply(target, args)
    }
  })
}

export function registerChatSurviveBroker(input: {
  child: ChildProcessWithoutNullStreams
  record: ChatSurviveRecord & { sessionId: string }
  recordPath: string
  /** An adopted broker's tracker, which its caller feeds with the broker's own offsets. */
  adopted?: { tracker: ChatSurviveStreamTracker; fenceFloor: number }
}): ChatSurviveEntry {
  const tracker = input.adopted?.tracker ?? createChatSurviveStreamTracker()
  const entry: ChatSurviveEntry = {
    sessionId: input.record.sessionId,
    child: input.child,
    record: input.record,
    recordPath: input.recordPath,
    tracker,
    fenceFloor: input.adopted?.fenceFloor ?? 0,
    state: 'live'
  }
  const { child } = input
  if (!input.adopted) {
    watchWithReader(child.stdout, tracker.stdout)
    watchWithReader(child.stderr, tracker.stderr)
  }
  interpose(child.stdin, 'write', ([chunk]) => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
      tracker.stdin(chunk)
    }
    return null
  })
  // A handed-off broker answers to the next app instance only.
  interpose(child, 'kill', () => (entry.state === 'detached' ? { skip: true, value: false } : null))
  child.once('exit', () => {
    entry.state = 'exited'
    if (bySession.get(entry.sessionId) === entry) {
      bySession.delete(entry.sessionId)
    }
  })
  bySession.set(entry.sessionId, entry)
  byChild.set(child, entry)
  return entry
}

/** A broker whose record could not be written: it stops at quit as today, never handed off. */
export function dropChatSurviveBroker(entry: ChatSurviveEntry): void {
  if (bySession.get(entry.sessionId) === entry) {
    bySession.delete(entry.sessionId)
  }
}

export function chatSurviveEntryForSession(sessionId: string): ChatSurviveEntry | null {
  return bySession.get(sessionId) ?? null
}

export function chatSurviveEntryForChild(
  child: ChildProcessWithoutNullStreams
): ChatSurviveEntry | null {
  return byChild.get(child) ?? null
}

/** A provider message as the app's reader hands it on; only its `uuid` matters here. */
type ConsumedMessage = { readonly uuid?: unknown }

/**
 * The app consumed one provider message (it reached the chat's journal): the replay mark moves
 * past it. Called for every Claude message; a child without a broker costs one map lookup.
 */
export function forkChatSurviveConsumed(
  child: ChildProcessWithoutNullStreams | null | undefined,
  message: ConsumedMessage
): void {
  const { uuid } = message
  if (child && typeof uuid === 'string') {
    byChild.get(child)?.tracker.consumed(uuid)
  }
}
