// Set up on a server (FORK.md, SLRM-2312): the "Set up on SERVER..." rows the new-workspace host
// picker adds after its host rows. Pure, so the picker's row builder can call it.
import type { NeedsSetupProjectHostOption } from '@/lib/workspace/creation/project-host-setup-options'
import type { RunTargetRowModel } from '@/components/new-workspace/run-target/run-target-options'

/** The run-target row kind these rows use. */
export const FORK_SERVER_SETUP_ROW_KIND = 'fork-setup'

export type ForkServerSetupRowModel = {
  key: string
  kind: typeof FORK_SERVER_SETUP_ROW_KIND
  option: NeedsSetupProjectHostOption
}

/** One row per paired server shown as lacking the project, when it could set it up now. */
export function forkServerSetupRows(rows: readonly RunTargetRowModel[]): ForkServerSetupRowModel[] {
  return rows.flatMap((row): ForkServerSetupRowModel[] =>
    row.kind === 'needs-setup' &&
    row.option.canSetLocation &&
    row.option.hostId.startsWith('runtime:')
      ? [
          {
            key: `fork-setup:${row.option.hostId}`,
            kind: FORK_SERVER_SETUP_ROW_KIND,
            option: row.option
          }
        ]
      : []
  )
}
