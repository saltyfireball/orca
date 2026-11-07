// SLRM-1394: one socket connection to a chat-survive broker, from its hello to its close.
import type { Socket } from 'node:net'
import {
  admitHello,
  applyOwnerFrame,
  refusalFrame,
  type ChatSurviveHelloState,
  type ChatSurviveOwnerActions
} from './chat-survive-broker-hello'
import { CHAT_SURVIVE_HELLO_TIMEOUT_MS } from './chat-survive-broker-types'
import {
  CHAT_SURVIVE_MAX_HELLO_BYTES,
  createLineDecoder,
  type ChatSurviveHello
} from './chat-survive-protocol'

export type ChatSurviveConnectionHooks<Owner> = {
  helloState: () => ChatSurviveHelloState
  /** Makes this socket the owner. */
  accept: (socket: Socket, hello: ChatSurviveHello) => Owner
  isOwner: (owner: Owner) => boolean
  actions: Omit<ChatSurviveOwnerActions, 'detach'>
  /** The owner's socket closed; `handedOff` says it sent `detach` first. */
  lost: (handedOff: boolean) => void
  closed: (socket: Socket) => void
}

export function serveChatSurviveConnection<Owner>(
  socket: Socket,
  hooks: ChatSurviveConnectionHooks<Owner>
): void {
  socket.on('error', () => {})
  let self: Owner | null = null
  let handedOff = false
  const helloTimer = setTimeout(() => socket.destroy(), CHAT_SURVIVE_HELLO_TIMEOUT_MS)
  const actions: ChatSurviveOwnerActions = {
    ...hooks.actions,
    detach: () => {
      handedOff = true
    }
  }
  const decoder = createLineDecoder((frame) => {
    if (self === null) {
      clearTimeout(helloTimer)
      const hello = admitHello(frame, hooks.helloState())
      if (typeof hello === 'string') {
        return void socket.end(refusalFrame(hello))
      }
      self = hooks.accept(socket, hello)
      return
    }
    if (frame && hooks.isOwner(self)) {
      applyOwnerFrame(frame, actions)
    }
  })
  socket.on('data', (chunk: Buffer) => {
    decoder.push(chunk)
    if (self === null && decoder.pending() > CHAT_SURVIVE_MAX_HELLO_BYTES) {
      socket.destroy()
    }
  })
  socket.on('close', () => {
    clearTimeout(helloTimer)
    hooks.closed(socket)
    if (self !== null && hooks.isOwner(self)) {
      hooks.lost(handedOff)
    }
  })
}
