// Letters and the board (FORK.md, SLRM-2389): fakes for the service tests. The store writes to a
// fresh temporary folder; the chat and terminal ports and paired servers are in memory.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readForkLettersSettings, type ForkLettersSettings } from '../../../shared/fork/letters'
import type { ForkLetterChat } from '../../../shared/fork/letters-wire'
import type {
  IdleRecoveryChatFacts,
  IdleRecoveryPorts,
  IdleRecoverySendOutcome
} from '../idle-recovery/idle-recovery-ports'
import type { ForkLettersDeps } from './letters-deps'
import { ForkLettersStore } from './letters-store'

export const chat = (id: string, extra: Partial<ForkLetterChat> = {}): ForkLetterChat => ({
  id,
  kind: 'chat',
  title: `Chat ${id}`,
  agent: 'claude',
  workspace: 'repo',
  worktreeId: 'wt-1',
  ...extra
})

export function fakeLetters(settings: ForkLettersSettings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fork-letters-test-'))
  let clock = 1_000_000
  let ids = 0
  const fake = {
    settings: { ...settings },
    chats: [chat('aaaa1111'), chat('bbbb2222'), chat('pane-key:1', { kind: 'terminal' })],
    records: new Set<string>(),
    facts: new Map<string, IdleRecoveryChatFacts>(),
    /** A chat that turns busy by the time the send checks again. */
    busyAtSend: new Set<string>(),
    terminalRefusal: null as string | null,
    outcome: 'sent' as IdleRecoverySendOutcome,
    sent: [] as { to: string; text: string }[],
    environments: [{ id: 'env-1', name: 'gpu-box' }],
    calls: [] as { env: string; method: string; params: unknown }[],
    answer: (_method: string, _params: unknown): unknown => ({}),
    kicks: 0,
    advance: (ms: number) => {
      clock += ms
    },
    deps: {} as ForkLettersDeps
  }
  const ports: IdleRecoveryPorts = {
    chat: {
      read: (id) => fake.facts.get(id) ?? null,
      send: async (to, text, _fence, stillIdle) => {
        if (fake.busyAtSend.has(to)) {
          fake.facts.set(to, { fence: 1, loaded: true, inTurn: true })
        }
        if (stillIdle && !stillIdle()) {
          return 'refused'
        }
        fake.sent.push({ to, text })
        return fake.outcome
      }
    },
    terminal: {
      bind: (paneKey) =>
        fake.chats.some((c) => c.id === paneKey)
          ? { handle: `h-${paneKey}`, binding: { ptyId: 'p', processIncarnation: 1 } as never }
          : null,
      refusal: async () => fake.terminalRefusal,
      send: async (bound, _agent, text, stillClear) => {
        if (!(await stillClear())) {
          return 'refused'
        }
        fake.sent.push({ to: bound.handle, text })
        return fake.outcome
      }
    }
  }
  fake.deps = {
    store: new ForkLettersStore(join(dir, 'fork-letters.json'), () => clock),
    settings: () => readForkLettersSettings(fake.settings),
    chats: async () => fake.chats,
    hasChatRecord: (id) => fake.records.has(id),
    ports: () => ports,
    environments: async () => fake.environments,
    callEnvironment: async (env, method, params) => {
      fake.calls.push({ env, method, params })
      return fake.answer(method, params)
    },
    hostName: () => 'desk',
    now: () => clock,
    newId: () => (ids += 1).toString(16).padStart(12, '0'),
    kick: () => {
      fake.kicks += 1
    }
  }
  return fake
}

export const idle: IdleRecoveryChatFacts = { fence: 1, loaded: true, inTurn: false }
