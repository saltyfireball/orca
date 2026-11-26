// Letters (FORK.md, SLRM-2389): the sender's receipt for a sent letter. Under Pause all (BAD-818) the
// host words it and returns it with the letter, and the CLI prints the host's words: a sender's CLI
// older than the host would otherwise say "queued" of a letter the host holds for resume-all.
import type { ForkLetter, ForkLetterParty } from './letters'
import { PAUSE_ALL_REASON_PREFIX } from './pause-all'

export function oneLetterLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

export function formatLetterParty(party: ForkLetterParty): string {
  const name =
    party.kind === 'shell'
      ? party.chatId
      : `${oneLetterLine(party.title, 60) || party.kind} (${oneLetterLine(party.chatId, 12)})`
  return party.host ? `${name} @${oneLetterLine(party.host.name, 60)}` : name
}

/** A queued letter Pause all holds (BAD-818): its note is the switch's reason. */
export const forkLetterHeldByPause = (letter: ForkLetter): boolean =>
  letter.state === 'queued' && letter.note?.startsWith(PAUSE_ALL_REASON_PREFIX) === true

export function formatLetterSent(letter: ForkLetter): string {
  const where =
    letter.state === 'forwarded'
      ? `handed to ${letter.to.host?.name ?? 'the paired server'}`
      : letter.state === 'pickup'
        ? 'waiting for the paired device to collect it'
        : forkLetterHeldByPause(letter)
          ? 'held by pause-all: delivered after `orca resume-all`, when the chat ends its turn'
          : 'queued: delivered when the chat ends its turn'
  return `Letter ${letter.id} to ${formatLetterParty(letter.to)}: ${where}.`
}
