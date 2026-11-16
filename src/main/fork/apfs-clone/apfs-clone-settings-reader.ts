// SLRM-2270 (FORK.md): where the worktree-create hooks read the APFS clone settings. Until the
// app installs a reader (tests, other entry points) both features are off, so stock creation runs.
import type { ForkApfsCloneSettings } from '../../../shared/fork/apfs-clone'

let reader: (() => ForkApfsCloneSettings | undefined) | null = null

export function installForkApfsCloneSettingsReader(
  next: (() => ForkApfsCloneSettings | undefined) | null
): void {
  reader = next
}

/** The current settings, or null when no reader is installed (both features off). */
export function readForkApfsCloneSettings(): ForkApfsCloneSettings | null {
  if (!reader) {
    return null
  }
  try {
    return reader() ?? {}
  } catch {
    return null
  }
}
