// Idle recovery (FORK.md), item E1: the runtime RPC behind `orca inbox` and the Decision inbox
// on paired hosts. Contract: each host answers for its own chats, through the same service
// calls the window bridge uses; the names and payloads are in `idle-recovery-wire.ts`.
import { defineMethod } from '../../core'
import {
  FORK_IDLE_RECOVERY_METHODS as NAMES,
  ForkIdleRecoveryAnswerParams,
  ForkIdleRecoveryInboxParams,
  ForkIdleRecoveryPauseParams,
  ForkIdleRecoveryStatusParams
} from '../../../../../shared/fork/idle-recovery-wire'
import {
  answerIdleRecoveryChat,
  listIdleRecoveryInbox,
  readIdleRecoveryStatus,
  setIdleRecoveryPaused
} from '../../../../fork/idle-recovery/idle-recovery-service'
import { FORK_PR_BABYSIT_RPC_METHODS } from './fork-pr-babysit'

export const FORK_IDLE_RECOVERY_RPC_METHODS = [
  defineMethod({
    name: NAMES.inbox,
    permission: 'workspace',
    params: ForkIdleRecoveryInboxParams,
    handler: async () => listIdleRecoveryInbox()
  }),
  defineMethod({
    name: NAMES.answer,
    permission: 'workspace',
    params: ForkIdleRecoveryAnswerParams,
    handler: async (params) => answerIdleRecoveryChat(params)
  }),
  defineMethod({
    name: NAMES.pause,
    permission: 'workspace',
    params: ForkIdleRecoveryPauseParams,
    handler: async (params) => setIdleRecoveryPaused(params)
  }),
  defineMethod({
    name: NAMES.status,
    permission: 'workspace',
    params: ForkIdleRecoveryStatusParams,
    handler: async () => readIdleRecoveryStatus()
  }),
  // SLRM-2386: the PR babysitter, whose stuck pull requests join this inbox (`orca babysit`).
  ...FORK_PR_BABYSIT_RPC_METHODS
] as const
