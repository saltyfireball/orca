// SLRM-1394: the quit hook. Instead of stopping a Claude chat's provider, the quitting app moves
// itself from its broker's stdio to the broker's socket (a takeover with the chat's fence), checks
// that the broker still holds every byte from the replay mark on, saves that mark in the broker's
// record and lets go. The provider carries on under the broker until the next app instance adopts
// it or the orphan timer stops it. Anything short of that returns false and the caller stops the
// provider as today; after a takeover that is the broker's own stop, so there is never a provider
// left running without a record that says how to resume it.
import type { ManagedProviderProcess } from '../../provider-process/managed-provider-process'
import type { ProviderProcessCloseResult } from '../../provider-process/provider-process-close'
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
      // Late is still ours: the broker stops the provider when the caller's stop signals it.
      void settled.then((late) => late?.detach())
    }
    return connection
  })
}

function keepsEverything(connection: ChatSurviveConnection, seen: number): boolean {
  const { welcome } = connection
  return welcome.exit === null && !welcome.out.truncated && welcome.out.end >= seen
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
  if (!chatSurviveEnabled() || !entry || entry.state !== 'live') {
    return false
  }
  entry.state = 'detaching'
  const mark = entry.tracker.mark()
  const connection = await takeOver(entry, fence, { out: mark.out, err: mark.err })
  if (!connection) {
    return undo(entry)
  }
  if (!keepsEverything(connection, mark.seen)) {
    connection.stop()
    return undo(entry)
  }
  try {
    writeChatSurviveRecord(entry.recordPath, { ...entry.record, detached: { ...mark, fence } })
  } catch {
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
  return new Proxy(managed, {
    get(target, property) {
      if (handedOff()) {
        if (property === 'close' || property === 'closeWriter') {
          return () => Promise.resolve(LIVE)
        }
        if (property === 'terminateTree') {
          return () => Promise.resolve('live')
        }
      }
      return Reflect.get(target, property, target)
    }
  })
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
