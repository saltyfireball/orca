// SLRM-1503 (FORK.md): move native Claude chats between this host's Claude accounts. Each host
// answers for its own chats, so a desktop or the CLI reaches a remote host's chats through that
// host's runtime (`--environment` / `--pairing-code`).
import { defineMethod } from '../../core'
import type { OrcadFeature } from '../../orcad-feature-readiness'
import {
  ForkClaudeAccountCancelParams,
  ForkClaudeAccountMoveParams,
  ForkClaudeAccountWhichParams
} from '../../../../../shared/fork/claude-account-move'
import { claudeAccountMoveService } from '../../../../fork/claude-account-move/claude-account-move-host'

// orcad installs its account router with its accounts feature.
const requires = ['accounts'] satisfies OrcadFeature[]

export const FORK_CLAUDE_ACCOUNT_MOVE_METHODS = [
  defineMethod({
    name: 'fork.claudeAccount.which',
    permission: 'workspace',
    params: ForkClaudeAccountWhichParams,
    requires,
    handler: async (params) => claudeAccountMoveService().which(params)
  }),
  defineMethod({
    name: 'fork.claudeAccount.move',
    permission: 'accounts-admin',
    params: ForkClaudeAccountMoveParams,
    requires,
    handler: async (params) => claudeAccountMoveService().move(params)
  }),
  defineMethod({
    name: 'fork.claudeAccount.cancel',
    permission: 'accounts-admin',
    params: ForkClaudeAccountCancelParams,
    requires,
    handler: async (params) => claudeAccountMoveService().cancel(params.sessionId)
  })
] as const
