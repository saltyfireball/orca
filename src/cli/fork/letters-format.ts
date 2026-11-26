// Letters and the board (FORK.md, SLRM-2389): what `orca letter` and `orca board` print.
import type { ForkBoardAsk, ForkLetter, ForkLetterParty } from '../../shared/fork/letters'
import { PAUSE_ALL_REASON_PREFIX } from '../../shared/fork/pause-all'
import type {
  ForkBoardListResult,
  ForkLettersChatsResult,
  ForkLettersListResult
} from '../../shared/fork/letters-wire'

function table(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows
    .map((cells) =>
      cells
        .map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col])))
        .join('  ')
    )
    .join('\n')
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

function age(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

export function formatLetterParty(party: ForkLetterParty): string {
  const name =
    party.kind === 'shell'
      ? party.chatId
      : `${oneLine(party.title, 60) || party.kind} (${oneLine(party.chatId, 12)})`
  return party.host ? `${name} @${oneLine(party.host.name, 60)}` : name
}

/** A queued letter Pause all holds (BAD-818): its note is the switch's reason. */
const heldByPause = (letter: ForkLetter): boolean =>
  letter.state === 'queued' && letter.note?.startsWith(PAUSE_ALL_REASON_PREFIX) === true

export function formatLetterSent(letter: ForkLetter): string {
  const where =
    letter.state === 'forwarded'
      ? `handed to ${letter.to.host?.name ?? 'the paired server'}`
      : letter.state === 'pickup'
        ? 'waiting for the paired device to collect it'
        : heldByPause(letter)
          ? 'held by pause-all: delivered after `orca resume-all`, when the chat ends its turn'
          : 'queued: delivered when the chat ends its turn'
  return `Letter ${letter.id} to ${formatLetterParty(letter.to)}: ${where}.`
}

export function formatLetterList(result: ForkLettersListResult): string {
  if (result.letters.length === 0) {
    return 'No letters.'
  }
  return table([
    ['ID', 'AGE', 'STATE', 'FROM', 'TO', 'TEXT'],
    ...result.letters.map((letter) => [
      letter.id,
      age(result.now - letter.at),
      heldByPause(letter) ? 'queued (pause-all)' : letter.state,
      formatLetterParty(letter.from),
      formatLetterParty(letter.to),
      oneLine(letter.text, 60)
    ])
  ])
}

export function formatLetterChats(result: ForkLettersChatsResult): string {
  if (result.chats.length === 0) {
    return 'No chats on this host.'
  }
  return table([
    ['ID', 'KIND', 'AGENT', 'WORKSPACE', 'TITLE'],
    ...result.chats.map((chat) => [
      chat.id,
      chat.kind,
      chat.agent,
      oneLine(chat.workspace, 30),
      oneLine(chat.title, 50)
    ])
  ])
}

export function formatBoardAsk(ask: ForkBoardAsk): string {
  const state = ask.state === 'open' ? 'open' : ask.state === 'done' ? 'done' : 'thrown back'
  return `Ask ${ask.id} (${ask.type}) ${state}: ${oneLine(ask.title, 200)}`
}

export function formatBoardList(result: ForkBoardListResult): string {
  if (result.asks.length === 0) {
    return 'The board is empty.'
  }
  return table([
    ['ID', 'TYPE', 'AGE', 'STATE', 'FROM', 'TITLE'],
    ...result.asks.map((ask) => [
      ask.id,
      ask.type,
      age(result.now - ask.at),
      ask.state,
      formatLetterParty(ask.from),
      oneLine(ask.title, 60)
    ])
  ])
}
