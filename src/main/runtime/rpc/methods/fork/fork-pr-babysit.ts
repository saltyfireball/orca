// PR babysitter (FORK.md, SLRM-2386): the runtime RPC behind `orca babysit`. Each host answers for
// the chats that run on it, so `--environment` reaches a headless server's babysitter.
import { defineMethod } from '../../core'
import {
  FORK_PR_BABYSIT_METHODS as NAMES,
  ForkPrBabysitListParams,
  ForkPrBabysitStartParams,
  ForkPrBabysitStopParams
} from '../../../../../shared/fork/pr-babysit-wire'
import {
  listForkPrBabysit,
  startForkPrBabysit,
  stopForkPrBabysit
} from '../../../../fork/pr-babysit/pr-babysit-hooks'

export const FORK_PR_BABYSIT_RPC_METHODS = [
  defineMethod({
    name: NAMES.list,
    permission: 'workspace',
    params: ForkPrBabysitListParams,
    handler: async () => listForkPrBabysit()
  }),
  defineMethod({
    name: NAMES.start,
    permission: 'workspace',
    params: ForkPrBabysitStartParams,
    handler: async (params) => startForkPrBabysit(params.pr)
  }),
  defineMethod({
    name: NAMES.stop,
    permission: 'workspace',
    params: ForkPrBabysitStopParams,
    handler: async (params) => stopForkPrBabysit(params.pr)
  })
] as const
