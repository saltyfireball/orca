// SLRM-1394: the recovery hook. A proven-alive local owner whose broker this instance adopted is
// released without a signal; any other owner is stopped exactly as before.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeTestJournalHostDatabases } from '../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { resolveStructuredSessionRecovery } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-recovery-resolution'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { codexProviderHandle } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'
import { forkChatSurviveAdopt } from './chat-survive-adopt'

vi.mock('./chat-survive-adopt', () => ({ forkChatSurviveAdopt: vi.fn() }))

const NOW = 1_800_000_000_000
const SESSION = 'session-survive'
const roots: string[] = []

afterEach(async () => {
  vi.mocked(forkChatSurviveAdopt).mockReset()
  await closeTestJournalHostDatabases()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** A store whose session has a live local owner (pid 4242) latched for recovery. */
async function recoveringOwner(): Promise<AgentSessionRecordStore> {
  const root = await mkdtemp(join(tmpdir(), 'orca-chat-survive-recovery-'))
  roots.push(root)
  const store = await openTestAgentSessionRecordStore(root)
  const reserved = await store.reserveOwner({
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex' },
    expectedFence: null,
    spawnToken: 'spawn-survive',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'test',
      operationId: `${NOW}-${'1'.padStart(32, '0')}`,
      fingerprint: 'create'
    },
    now: NOW
  })
  const fence = reserved.record.lease.runtimeFence
  const process = {
    hostId: 'local',
    pid: 4242,
    processStartTimeMs: NOW - 1_000,
    spawnToken: 'spawn-survive'
  }
  await store.commitProcessIdentity({ sessionId: SESSION, fence, process, now: NOW })
  await store.proveOwner({
    sessionId: SESSION,
    fence,
    link: {
      linkId: 'link-survive',
      handle: codexProviderHandle('thread-survive'),
      origin: 'created',
      mintedAtFence: fence,
      observedAt: NOW
    },
    now: NOW
  })
  await store.transitionHandoff(SESSION, (record) => ({
    ...record,
    lease: { ...record.lease, handoffStage: 'recovering' }
  }))
  return store
}

function resolve(store: AgentSessionRecordStore, stopOwnerProcess: () => void) {
  return resolveStructuredSessionRecovery(
    {
      store,
      probeRecord: async () => ({ outcome: 'identity-matched', matchedOn: ['process-start-time'] }),
      now: () => NOW + 10_000,
      delay: async () => {},
      stopOwnerProcess,
      platform: 'darwin'
    },
    SESSION
  )
}

describe('chat-survive recovery hook', () => {
  it('releases an adopted owner without signalling it', async () => {
    const store = await recoveringOwner()
    vi.mocked(forkChatSurviveAdopt).mockResolvedValue(true)
    const stopOwnerProcess = vi.fn()

    await expect(resolve(store, stopOwnerProcess)).resolves.toBe('resolved')
    expect(forkChatSurviveAdopt).toHaveBeenCalledWith({
      sessionId: SESSION,
      ownerPid: 4242,
      platform: 'darwin'
    })
    expect(stopOwnerProcess).not.toHaveBeenCalled()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'released',
      handoffStage: null,
      ownerProcess: null
    })
  })

  it('stops the owner as before when the claim fails', async () => {
    const store = await recoveringOwner()
    vi.mocked(forkChatSurviveAdopt).mockResolvedValue(false)
    const stopOwnerProcess = vi.fn()

    await expect(resolve(store, stopOwnerProcess)).resolves.toBe('resolved')
    expect(stopOwnerProcess).toHaveBeenCalledWith(4242, 'SIGTERM')
  })
})
