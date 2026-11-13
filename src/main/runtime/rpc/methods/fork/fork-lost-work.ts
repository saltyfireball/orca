// SLRM-2096 (FORK.md "Lost work"): `orca lost-work` reads the same read-only scan as the desktop's
// Lost work dialog. Only the desktop app installs the scan host, so a host without it says so.
import { defineMethod } from '../../core'
import { ForkLostWorkScanParams } from '../../../../../shared/fork/lost-work'
import {
  forkLostWorkStore,
  runForkLostWorkScan
} from '../../../../fork/lost-work/lost-work-service'

export const FORK_LOST_WORK_METHODS = [
  defineMethod({
    name: 'fork.lostWork.scan',
    permission: 'workspace',
    params: ForkLostWorkScanParams,
    handler: async (params, ctx) => {
      const store = forkLostWorkStore()
      if (!store) {
        throw new Error('The lost work scan runs in the Orca desktop app; open it and try again.')
      }
      const wanted = params.repo
      return runForkLostWorkScan(
        store,
        ctx.signal,
        wanted ? (repo) => repo.id === wanted || repo.displayName === wanted : undefined
      )
    }
  })
] as const
