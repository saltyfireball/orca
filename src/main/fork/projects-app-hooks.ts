// The desktop's project-side fork features, started from one line in src/main/index.ts, which is
// at max-lines: snooze (SLRM-2269) and branch clashes (SLRM-2394). See FORK.md.
import { installForkSnoozeApp } from './snooze/snooze-ipc'
import { installForkBranchClashesApp } from './branch-clashes/branch-clashes-app'

export function installForkProjectApps(readSettings: () => unknown): void {
  installForkSnoozeApp(readSettings)
  installForkBranchClashesApp(readSettings)
}
