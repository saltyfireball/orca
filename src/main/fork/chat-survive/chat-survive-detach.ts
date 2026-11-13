// SLRM-1394: the quit hook. Instead of stopping a Claude chat's provider, the quitting app moves
// itself from its broker's stdio to the broker's socket (a takeover with the chat's fence), checks
// that the broker still holds every byte from the replay mark on, saves that mark in the broker's
// record and lets go. The provider carries on under the broker until the next app instance adopts
// it or the orphan timer stops it. Anything short of that returns false and the caller stops the
// provider as today; after a takeover that is the broker's own stop, so there is never a provider
// left running without a record that says how to resume it.
import type { ManagedProviderProcess } from '../../provider-process/managed-provider-process'
import type { ProviderProcessCloseResult } from '../../provider-process/provider-process-close'
import type { ProviderProcessTeardownVerdict } from '../../provider-process/provider-process-teardown'
import { connectChatSurviveBroker, type ChatSurviveConnection } from './chat-survive-client'
import {
  chatSurviveEntryForChild,
  chatSurviveEntryForSession,
  writeChatSurviveRecord,
  type ChatSurviveEntry
} from './chat-survive-registry'
import { chatSurviveEnabled } from './chat-survive-spawn'

/** How long the quit waits for its own broker to take it over the socket. */
const TAKEOVER_TIMEOUT_MS = 1_000

/** The provider of a Claude chat that would outlive this app instance if it quit now. */
export function chatSurviveWillSurvive(sessionId: string): boolean {
  return chatSurviveEnabled() && chatSurviveEntryForSession(sessionId)?.state === 'live'
}

function takeOver(entry: ChatSurviveEntry, fence: number, from: { out: number; err: number }) {
  const timeout = Promise.withResolvers<null>()
  const timer = setTimeout(() => timeout.resolve(null), TAKEOVER_TIMEOUT_MS)
  const connecting = connectChatSurviveBroker({
    socketPath: entry.record.socketPath,
    token: entry.record.token,
    fence,
    from,
    takeover: true
  })
  const settled = connecting.then(
    (connection) => connection,
    () => null
  )
  return Promise.race([settled, timeout.promise]).then((connection) => {
    clearTimeout(timer)
    if (!connection) {
      // Late is still ours and the caller stops the provider as today; so does the broker.
      void settled.then((late) => late?.stop())
    }
    return connection
  })
}

function keepsEverything(connection: ChatSurviveConnection, delivered: number): boolean {
  const { welcome } = connection
  return welcome.exit === null && !welcome.out.truncated && welcome.out.end >= delivered
}

/** Back to live unless the broker exited meanwhile; the caller stops the provider as today. */
function undo(entry: ChatSurviveEntry): false {
  if (entry.state === 'detaching') {
    entry.state = 'live'
  }
  return false
}

/**
 * Hands one chat's provider to its broker for the next app instance. True only when the broker
 * took over, holds the replay, and the record says where to resume; the caller must then leave
 * the provider alone.
 */
export async function detachChatSurvive(sessionId: string, fence: number): Promise<boolean> {
  const entry = chatSurviveEntryForSession(sessionId)
  // Only macOS adopts at start (chat-survive-adopt.ts); elsewhere a hand-off would only orphan it.
  if (process.platform !== 'darwin' || !chatSurviveEnabled() || !entry || entry.state !== 'live') {
    return false
  }
  entry.state = 'detaching'
  const mark = entry.tracker.mark()
  const fenceAbove = Math.max(fence, entry.fenceFloor + 1)
  const connection = await takeOver(entry, fenceAbove, { out: mark.out, err: mark.err })
  if (!connection) {
    return undo(entry)
  }
  if (!keepsEverything(connection, mark.delivered)) {
    connection.stop()
    return undo(entry)
  }
  try {
    // Lands after the spawn's own write of this record, never before it.
    await writeChatSurviveRecord(entry.recordPath, {
      ...entry.record,
      detached: { ...mark, fence: fenceAbove }
    })
  } catch {
    connection.stop()
    return undo(entry)
  }
  // The broker can exit while the record is written; then there is nothing left to hand off.
  if (entry.state !== 'detaching' || chatSurviveEntryForSession(sessionId) !== entry) {
    connection.stop()
    return undo(entry)
  }
  entry.state = 'detached'
  connection.detach()
  return true
}

const LIVE: ProviderProcessCloseResult = { root: 'live', tree: 'live' }

/**
 * The managed provider process as the app's close paths see it. Once its broker is handed off,
 * every close reports the provider live without signalling it, which is the truth: the session's
 * lease stays held and the next instance's recovery decides what happens to it.
 */
export function forkChatSurviveManaged(managed: ManagedProviderProcess): ManagedProviderProcess {
  const handedOff = (): boolean => chatSurviveEntryForChild(managed.child)?.state === 'detached'
  const closedLive = (): Promise<ProviderProcessCloseResult> => Promise.resolve(LIVE)
  // Every read goes through to `managed` at the moment it is made, and writes land on it too.
  return {
    get child() {
      return managed.child
    },
    set child(child) {
      managed.child = child
    },
    get supervised() {
      return managed.supervised
    },
    set supervised(supervised) {
      managed.supervised = supervised
    },
    get processless() {
      return managed.processless
    },
    get rootVerdict() {
      return managed.rootVerdict
    },
    get rootExitObserved() {
      return managed.rootExitObserved
    },
    get lastCloseResult() {
      return managed.lastCloseResult
    },
    get exitStatus() {
      return managed.exitStatus
    },
    get exitPromise() {
      return managed.exitPromise
    },
    get executableMissing() {
      return managed.executableMissing
    },
    get spawnAbsence() {
      return managed.spawnAbsence
    },
    get stderrTail() {
      return managed.stderrTail
    },
    get onExit() {
      return managed.onExit
    },
    get terminateTree() {
      return handedOff()
        ? (): Promise<ProviderProcessTeardownVerdict> => Promise.resolve('live')
        : managed.terminateTree
    },
    get close() {
      return handedOff() ? closedLive : managed.close
    },
    get closeWriter() {
      return handedOff() ? closedLive : managed.closeWriter
    }
  }
}

/** The quit hook for one session: true leaves its provider running for the next app instance. */
export function forkChatSurviveQuit(
  sessionId: string,
  child: { readonly phase: string; readonly close?: unknown; readonly fence: number } | null
): Promise<boolean> {
  // Only a settled child with no stop under way; anything else stops as today.
  if (!child || child.phase !== 'ready' || child.close !== undefined) {
    return Promise.resolve(false)
  }
  return detachChatSurvive(sessionId, child.fence)
}
