// Review guides (SLRM-2396, FORK.md): runs the guide writer as a one-shot text task, the way Orca
// writes a pull request description: same agent, model and read-only tool policy as the
// source-control "pull request" writer. Stock text tasks stop at 60 seconds, which a guide for a
// large pull request can outrun, so Claude runs under the guide's own time limit and with no tools
// at all: the prompt carries the whole pull request, and the pull request's text is untrusted.
// Every other agent goes through the stock path unchanged, so agents that need a prepared
// read-only policy always get it.
import { planCommitMessageGeneration } from '../../../shared/source-control/ai/generation/commit-message-plan'
import type { ResolvedSourceControlAiGenerationParams } from '../../../shared/source-control/ai/source-control-ai-operation-resolution'
import { runClaudeGenerationAttempts } from '../../../shared/text-generation/launch/claude-background-run-isolation'
import { mergeCommandEnvironment } from '../../../shared/shell/launch/command-environment'
import { textGenerationFailureCodeFields } from '../../../shared/text-generation/text-generation-failure-copy'
import {
  commandBackslashMode,
  runGenerationRequest
} from '../../text-generation/agent-generation-request'
import { spawnSourceControlAgent } from '../../text-generation/execution/source-control-agent-launch'
import { runLocalSourceControlPlan } from '../../text-generation/execution/source-control-local-process'
import type {
  InternalTextGenerationResult,
  LocalGenerationTarget,
  SpawnSourceControlAgent
} from '../../text-generation/source-control-text-generation-types'

/** JSON answers skip the reasoning-preamble strip that free-text tasks get, as PR fields do. */
export const FORK_REVIEW_GUIDE_OPERATION = 'pull-request-fields'

export type ForkReviewGuideAgentInput = {
  params: ResolvedSourceControlAiGenerationParams
  prompt: string
  target: LocalGenerationTarget
  timeoutMs: number
  spawnAgent?: SpawnSourceControlAgent
}

export async function runForkReviewGuideAgent(
  input: ForkReviewGuideAgentInput
): Promise<InternalTextGenerationResult> {
  const spawnAgent = input.spawnAgent ?? spawnSourceControlAgent
  if (input.params.agentId !== 'claude' || input.target.wslDistro) {
    return runGenerationRequest({
      params: input.params,
      prompt: input.prompt,
      target: input.target,
      operation: FORK_REVIEW_GUIDE_OPERATION,
      spawnAgent
    })
  }
  const params = {
    ...input.params,
    backslash: commandBackslashMode(input.target),
    toolFree: true
  }
  return runClaudeGenerationAttempts({
    agentId: input.params.agentId,
    run: async (attempt): Promise<InternalTextGenerationResult> => {
      const planned = planCommitMessageGeneration(params, input.prompt, attempt)
      if (!planned.ok) {
        return {
          success: false,
          error: planned.error,
          ...textGenerationFailureCodeFields(planned)
        }
      }
      return runLocalSourceControlPlan({
        plan: planned.plan,
        cwd: input.target.cwd,
        env: mergeCommandEnvironment(input.target.env, planned.plan.env, process.platform),
        operation: FORK_REVIEW_GUIDE_OPERATION,
        laneId: input.target.laneId,
        spawnAgent,
        timeoutMs: input.timeoutMs
      }).result
    },
    failedExit: (outcome) => (outcome.success ? undefined : outcome.failureOutput)
  })
}
