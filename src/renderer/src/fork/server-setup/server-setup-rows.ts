// Set up on a server (FORK.md, SLRM-2312): which hosts of the new-workspace host picker get a
// "Set up on SERVER..." row. Pure, so it is tested without the picker.
import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/workspace/creation/project-host-setup-options'

/** The id prefix of these rows in the picker's host list. */
export const FORK_SERVER_SETUP_ROW_PREFIX = 'fork-setup:'

/** Each paired server shown as lacking the project, when it could set it up now. */
export function forkServerSetupCandidates(
  hostOptions: readonly ProjectHostSetupOption[]
): NeedsSetupProjectHostOption[] {
  return hostOptions.filter(
    (option): option is NeedsSetupProjectHostOption =>
      option.kind === 'needs-setup' && option.canSetLocation && option.hostId.startsWith('runtime:')
  )
}
