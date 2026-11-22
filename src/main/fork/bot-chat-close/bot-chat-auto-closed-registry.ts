// The chats Orca closed by itself (FORK.md, BAD-734), kept in `fork-bot-chats-auto-closed.json` in the
// data folder. Mail for one of them reopens it first, so an auto-close never refuses or drops a message;
// a chat the owner closed by hand is not listed and stays closed.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { ORCA_SESSION_ADDRESS_PREFIX } from '../../../shared/agent-session/identity/orca-session-address-prefix'

export const FORK_BOT_CHATS_AUTO_CLOSED_FILE = 'fork-bot-chats-auto-closed.json'
const MAX_KEPT = 500

export type AutoClosedChats = Record<string, { botId: string; at: number }>

let kept: AutoClosedChats | null = null
let loading: Promise<AutoClosedChats> | null = null

function filePath(): string {
  return join(getAppEnvironment().getPath('userData'), FORK_BOT_CHATS_AUTO_CLOSED_FILE)
}

async function load(): Promise<AutoClosedChats> {
  if (kept) {
    return kept
  }
  loading ??= readFile(filePath(), 'utf8')
    .then((text): AutoClosedChats => {
      const parsed: unknown = JSON.parse(text)
      return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
    })
    .catch(() => ({}))
    .then((loaded) => {
      kept = { ...loaded, ...kept }
      return kept
    })
  return loading
}

async function save(chats: AutoClosedChats): Promise<void> {
  const target = filePath()
  const newest = Object.entries(chats)
    .toSorted((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_KEPT)
  const next = Object.fromEntries(newest)
  kept = next
  try {
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(next), 'utf8')
    await rename(temp, target)
  } catch (error) {
    console.warn('[fork bot chat auto-close] could not save the closed list', error)
  }
}

export async function rememberAutoClosedChat(chatId: string, botId: string): Promise<void> {
  const chats = await load()
  await save({ ...chats, [chatId]: { botId, at: Date.now() } })
}

export async function forgetAutoClosedChat(chatId: string): Promise<void> {
  const chats = await load()
  if (chatId in chats) {
    const { [chatId]: _gone, ...rest } = chats
    await save(rest)
  }
}

export async function isAutoClosedChat(chatId: string): Promise<boolean> {
  return chatId in (await load())
}

/** The bare chat id a recipient names: an address, a `chat:` id or the id itself. */
export function autoClosedChatKey(recipient: string): string {
  const bare = recipient.startsWith(ORCA_SESSION_ADDRESS_PREFIX)
    ? recipient.slice(ORCA_SESSION_ADDRESS_PREFIX.length)
    : recipient
  return bare.startsWith('chat:') ? bare.slice('chat:'.length) : bare
}

export function resetAutoClosedRegistryForTest(): void {
  kept = null
  loading = null
}
