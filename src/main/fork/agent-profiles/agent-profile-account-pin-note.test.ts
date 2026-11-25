// BAD-800 proof: a profile chat whose Claude account pin cannot be saved says so in the chat. The
// chat is created by a real structured session host, the pin goes to the real pin store (whose
// folder cannot be made), and the note is read back from the chat's own journal.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTestHostJournal } from '../../native-chat/agent-session-journal/journal-observation.test-support'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { createTestParams } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-create.test-fixture'
import { HOST_TEST_SESSION as SESSION } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import {
  createRestTestRig,
  REST_TEST_CALLER as CALLER,
  type RestTestRig
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'
import {
  ClaudeSessionAccountPins,
  setClaudeSessionAccountPinsForTests
} from '../claude-account-move/claude-session-account-pins'
import { withForkMcpLaunchScope } from '../mcp-profiles/mcp-launch-scope'
import { installForkAgentProfileLaunch } from './agent-profile-launch-scope'

const settings = {
  forkAgentProfiles: [{ name: 'reviewer', agent: 'claude', account: 'dev@example.com' }],
  claudeManagedAccounts: [{ id: 'acct-1', email: 'dev@example.com', managedAuthRuntime: 'host' }]
}

let folder: string
let rig: RestTestRig

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'fork-pin-note-'))
  // The pin file's folder is a plain file, so saving the pin fails.
  writeFileSync(join(folder, 'not-a-folder'), '')
  const pins = new ClaudeSessionAccountPins(join(folder, 'not-a-folder', 'pins.json'))
  setClaudeSessionAccountPinsForTests(pins)
  installForkAgentProfileLaunch({
    readSettings: () => settings,
    claudeRouter: () => ({
      accountLogin: () => ({ email: 'dev@example.com' }),
      coveredBySystemDefault: () => false
    })
  })
  rig = await createRestTestRig()
  setStructuredAgentSessionHost(rig.host)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  setStructuredAgentSessionHost(null)
  setClaudeSessionAccountPinsForTests(null)
  await rig.dispose()
  rmSync(folder, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('a profile chat whose account pin fails (BAD-800)', () => {
  it('shows the person a note in the chat', async () => {
    const created = await withForkMcpLaunchScope(
      {
        request: {
          method: 'agent.launch',
          params: { agent: 'claude', forkAgentProfile: 'reviewer' }
        }
      },
      () =>
        rig.host.create(
          CALLER,
          createTestParams(undefined, {
            agent: 'claude',
            provider: 'claude',
            accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(folder, 'claude') }
          })
        )
    )
    expect(created).toMatchObject({ ok: true })
    const note = await vi.waitFor(async () => {
      const { items } = await readTestHostJournal(rig.host, SESSION)
      const found = items.find(
        (item) => item.body.kind === 'status' && item.body.tone === 'warning'
      )
      expect(found).toBeDefined()
      return found
    })
    expect(note?.body).toMatchObject({
      kind: 'status',
      text: expect.stringMatching(
        /^Profile reviewer: Orca could not save this chat's Claude account \(.+\)\./
      )
    })
  })
})
