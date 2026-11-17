// Limit resume (FORK.md, SLRM-2309): `orca limits`. List what is parked on a usage limit on this
// host, resume one now, or cancel its resume. No call carries text: the resume message is only the
// host's own setting.
import { defineMethod } from '../../core'
import {
  ForkLimitsListParams,
  ForkLimitsTargetParams,
  type ForkLimitsActionResult,
  type ForkLimitsListResult
} from '../../../../../shared/fork/limit-resume-wire'
import {
  forkLimitResumeCancel,
  forkLimitResumeEntries,
  forkLimitResumeNow
} from '../../../../fork/limit-resume/limit-resume-service'

export const FORK_LIMIT_RESUME_METHODS = [
  defineMethod({
    name: 'fork.limits.list',
    permission: 'workspace',
    params: ForkLimitsListParams,
    handler: async (): Promise<ForkLimitsListResult> => ({
      now: Date.now(),
      entries: forkLimitResumeEntries()
    })
  }),
  defineMethod({
    name: 'fork.limits.resumeNow',
    permission: 'workspace',
    params: ForkLimitsTargetParams,
    handler: (params): Promise<ForkLimitsActionResult> => forkLimitResumeNow(params.id)
  }),
  defineMethod({
    name: 'fork.limits.cancel',
    permission: 'workspace',
    params: ForkLimitsTargetParams,
    handler: (params): Promise<ForkLimitsActionResult> => forkLimitResumeCancel(params.id)
  })
] as const
