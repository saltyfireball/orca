// SLRM-1503: the move service wired to this process's chat host and Claude account router. Each
// runtime (this desktop, a paired or SSH host, orcad) builds its own, so a move always runs on the
// host that owns the chat and uses that host's accounts.
import { realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { agentSessionAccountHomePath } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import { structuredAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/structured-agent-session-mutation'
import { getClaudeProfileRouter } from '../../claude-accounts/claude-profile-installed-router'
import type { ClaudeProfileRouter } from '../../claude-accounts/claude-profile-router'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'
import { ClaudeAccountMoveService, type ClaudeAccountMoveDeps } from './claude-account-move-service'
import { pinnedClaudeRoute } from './claude-pinned-route'
import { claudeSessionAccountPins } from './claude-session-account-pins'

const CALLER_KEY = 'trusted-local:fork-claude-account-move'

function projectsFolder(home: string): string | null {
  try {
    return realpathSync(join(home, 'projects'))
  } catch {
    return null
  }
}

/** Stock account setup links each account's `projects` to System default's, so a resume finds it. */
export function claudeHomesShareHistory(fromHome: string, toHome: string): boolean {
  const from = projectsFolder(fromHome)
  return from === null || from === projectsFolder(toHome)
}

async function stopTurn(host: StructuredAgentSessionHost, sessionId: string): Promise<boolean> {
  const fence = host.deps.store.getConversation(sessionId)?.currentFence
  if (fence === undefined) {
    return false
  }
  const result = await host
    .cancel(
      { callerKey: CALLER_KEY },
      {
        envelope: {
          sessionId,
          clientOperationId: mintAgentSessionOperationId(Date.now()),
          expectedRuntimeFence: fence,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: 'agentSession.cancel',
            sessionId,
            fields: {}
          })
        }
      }
    )
    .catch(() => null)
  return result?.ok === true
}

function hostDeps(
  host: StructuredAgentSessionHost,
  router: ClaudeProfileRouter
): ClaudeAccountMoveDeps {
  const store = host.deps.store
  return {
    hostName: hostname(),
    records: () => store.listRecords(),
    record: (sessionId) => store.getRecord(sessionId),
    inView: (sessionId) =>
      host.loadedSessionIds().includes(sessionId) || store.isSessionTabVisible(sessionId),
    summary: (sessionId) => host.readStatusSummary(sessionId),
    runningHome: (sessionId) =>
      agentSessionAccountHomePath(host.childAccountHome(sessionId) ?? null) ?? undefined,
    accountLabel: (accountId) => router.savedAccount(accountId)?.email,
    route: (pin) => pinnedClaudeRoute(router, pin),
    systemHome: () => router.systemDefaultHome(),
    selectedAccountId: () => router.selectedProfile()?.accountId ?? null,
    sharesHistory: claudeHomesShareHistory,
    prepareAccount: async (accountId) => {
      await router.prepareAccount(accountId)
    },
    pins: claudeSessionAccountPins(),
    stopTurn: (record) => stopTurn(host, record.sessionId)
  }
}

let service: { host: StructuredAgentSessionHost; service: ClaudeAccountMoveService } | null = null

/** The service for this host's chats; throws when this host runs no chats or has no accounts. */
export function claudeAccountMoveService(): ClaudeAccountMoveService {
  const host = getStructuredAgentSessionHost()
  const router = getClaudeProfileRouter()
  if (!host || !router) {
    throw new Error('This host runs no native Claude chats.')
  }
  // A new chat host (after a restart of the chat layer) gets a fresh queue of pending moves.
  if (service?.host !== host) {
    service = { host, service: new ClaudeAccountMoveService(hostDeps(host, router)) }
  }
  return service.service
}
