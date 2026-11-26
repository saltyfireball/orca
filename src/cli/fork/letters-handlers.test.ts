// Letters and the board (FORK.md, SLRM-2389): `orca letter` and `orca board` routing, the caller
// claim read from the environment, the tables, and the receipt the host words (BAD-818).
import { describe, expect, it, vi } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../arguments/args'
import { FORK_LETTERS_COMMAND_SPECS } from './letters-specs'
import { FORK_LETTERS_HANDLERS, forkLetterCallerClaim } from './letters-handlers'
import { formatBoardList, formatLetterList } from './letters-format'
import { formatLetterSent } from '../../shared/fork/letters-receipt'
import type { ForkLetter } from '../../shared/fork/letters'

function route(argv: string[]) {
  const paths = FORK_LETTERS_COMMAND_SPECS.map((spec) => spec.path)
  return normalizeCommandPositionals(
    FORK_LETTERS_COMMAND_SPECS,
    parseArgs(argv, paths, FORK_LETTERS_COMMAND_SPECS)
  )
}

const letter: ForkLetter = {
  id: 'a1b2c3d4e5f6',
  from: {
    chatId: 'aaaa1111',
    kind: 'chat',
    title: 'Sender',
    agent: 'claude',
    worktreeId: null,
    host: null
  },
  to: {
    chatId: 'bbbb2222',
    kind: 'terminal',
    title: 'Builder',
    agent: 'codex',
    worktreeId: null,
    host: { kind: 'environment', id: 'env-1', name: 'gpu-box' }
  },
  text: 'Rebase\non main',
  cite: null,
  at: 0,
  state: 'forwarded',
  settledAt: 0,
  note: null,
  tries: 1
}

describe('orca letter and orca board routing', () => {
  it('reads the positionals and flags', () => {
    const send = route(['letter', 'send', 'bbbb', 'hello there', '--cite', 'abcd', '--host', 'gpu'])
    expect(send.commandPath).toEqual(['letter', 'send'])
    expect(send.flags.get('to')).toBe('bbbb')
    expect(send.flags.get('text')).toBe('hello there')
    expect(send.flags.get('cite')).toBe('abcd')
    expect(send.flags.get('host')).toBe('gpu')
    const add = route(['board', 'add', 'DECIDE', 'Keep the API?', '--body', 'A or B'])
    expect(add.commandPath).toEqual(['board', 'add'])
    expect(add.flags.get('type')).toBe('DECIDE')
    expect(add.flags.get('title')).toBe('Keep the API?')
    const back = route(['board', 'back', '3f2a', 'Split it'])
    expect(back.flags.get('id')).toBe('3f2a')
    expect(back.flags.get('note')).toBe('Split it')
    expect(route(['board', 'list', '--all']).flags.get('all')).toBe(true)
  })

  it('names the calling chat from its environment', () => {
    expect(forkLetterCallerClaim({ ORCA_AGENT_SESSION_ID: 's1', ORCA_PANE_KEY: 'p' })).toEqual({
      sessionId: 's1'
    })
    expect(forkLetterCallerClaim({ ORCA_PANE_KEY: 'tab:1' })).toEqual({ paneKey: 'tab:1' })
    expect(forkLetterCallerClaim({})).toBeUndefined()
  })
})

describe('the tables', () => {
  it('prints a sent letter and the list', () => {
    expect(formatLetterSent(letter)).toBe(
      'Letter a1b2c3d4e5f6 to Builder (bbbb2222) @gpu-box: handed to gpu-box.'
    )
    const table = formatLetterList({ now: 120_000, letters: [letter] })
    expect(table).toMatch(/a1b2c3d4e5f6\s+2m\s+forwarded\s+Sender \(aaaa1111\)/)
    expect(table).toContain('Rebase on main')
    expect(formatLetterList({ now: 0, letters: [] })).toBe('No letters.')
    expect(formatBoardList({ now: 0, asks: [] })).toBe('The board is empty.')
  })
})

describe('the receipt of a sent letter', () => {
  const queued: ForkLetter = { ...letter, to: { ...letter.to, host: null }, state: 'queued' }

  async function sent(result: unknown): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await FORK_LETTERS_HANDLERS['letter send']!({
        flags: new Map([
          ['to', 'bbbb2222'],
          ['text', 'hi']
        ]),
        client: {
          call: async () => ({ id: '1', ok: true, result, _meta: { runtimeId: 'h' } })
        } as never,
        cwd: '/',
        json: false
      })
      return log.mock.calls.map((call) => String(call[0])).join('\n')
    } finally {
      log.mockRestore()
    }
  }

  it("prints the host's own receipt, on one line and without control characters", async () => {
    // A host newer than this CLI words a hold this CLI knows nothing of.
    const receipt = 'Letter a1 to Builder: held by a newer rule.\u001b[2J\n(see the host)'
    expect(await sent({ letter: queued, receipt })).toBe(
      'Letter a1 to Builder: held by a newer rule.[2J (see the host)'
    )
  })

  it('words the receipt itself for an older host', async () => {
    expect(await sent({ letter: queued })).toBe(
      'Letter a1b2c3d4e5f6 to Builder (bbbb2222): queued: delivered when the chat ends its turn.'
    )
  })
})
