// Fork (SLRM-1473): the Claude session the letter ledger test dispatches into. Upstream 1.4.262
// removed the dispatch suite's shared support file, so the ledger test keeps its own copy.
import { vi, type Mock } from 'vitest'
import { ClaudeJournalBoundDelivery } from './journal/claude-journal-bound-delivery'
import type { AgentJournalMessageItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { ClaudeSession } from './claude-structured-session-state'
import { ClaudeBackgroundTaskTracker } from '../background-tasks/claude-background-task-tracker'
import { ClaudeChildWorkDecoder } from '../child-work/claude-child-work-decoder'
import { ClaudeSlashCommandCatalog } from '../command-catalog/claude-slash-command-catalog'
import { createClaudeInitProof } from './startup/claude-structured-init-proof'
import { createClaudeStartupOutcome } from './startup/claude-structured-startup-outcome'
import { claudeProviderHandleLink } from './lifecycle/claude-structured-owner-identity'

export function sessionFor(send: Mock = vi.fn().mockResolvedValue(undefined)): ClaudeSession {
  return {
    connection: { send } as unknown as ClaudeSession['connection'],
    providerSessionId: 'provider-session',
    leafUuid: null,
    turnEndLeafUuid: null,
    fence: 1,
    acquisitionGeneration: 'generation-1',
    prompts: {} as ClaudeSession['prompts'],
    dispatchWaiters: [],
    retiredDispatchWaiters: [],
    replayContentFallbackBlocked: false,
    delivery: new ClaudeJournalBoundDelivery(),
    backgroundTasks: new ClaudeBackgroundTaskTracker(),
    childWork: new ClaudeChildWorkDecoder(),
    commands: new ClaudeSlashCommandCatalog(),
    dispatchSequence: 0,
    optionMutationSequence: 0,
    options: new Map(),
    reportedOptions: {},
    reportedModelMutation: 0,
    confirmedOptions: new Set(),
    appliedInputOptions: new Map(),
    fastModeAtStart: false,
    capabilities: [],
    events: undefined,
    translator: null,
    link: claudeProviderHandleLink({
      sessionId: 'provider-session',
      leafUuid: null,
      resumed: false,
      fence: 1,
      observedAt: 1
    }),
    initialization: {
      proof: createClaudeInitProof(),
      account: undefined,
      resumesTranscript: false,
      claudeConfigDir: '/claude-home',
      cwd: '/work',
      history: { leafUuid: null, covered: true, contextActivity: 0 },
      onLateRefusal: () => {},
      startup: createClaudeStartupOutcome()
    }
  }
}

export function userMessage(blocks: AgentJournalMessageItem['blocks']): AgentJournalMessageItem {
  return { kind: 'message', role: 'user', blocks }
}
