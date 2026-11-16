// SLRM-2270 (FORK.md): faster new worktrees on macOS with APFS copy-on-write clones. The
// settings and the checks on them; the main process does the cloning (src/main/fork/apfs-clone).

export type ForkApfsCloneSettings = {
  /** Fork (SLRM-2270): on macOS, fill a new worktree by cloning a cached checkout of the project with APFS copy-on-write instead of writing every file; off unless true. */
  forkApfsCloneCheckout?: boolean
  /** Fork (SLRM-2270): on macOS, git-ignored folders (paths relative to the project) cloned from the project's own checkout into each new worktree with APFS copy-on-write; unset is node_modules, empty is none. */
  forkApfsCloneFolders?: string[]
}

export const FORK_APFS_CLONE_DEFAULT_FOLDERS: readonly string[] = ['node_modules']

/** Longest folder entry kept; longer ones are dropped as typos or pastes. */
const MAX_FOLDER_LENGTH = 200
/** Most folder entries used; the rest are ignored. */
export const FORK_APFS_CLONE_MAX_FOLDERS = 20

export function forkApfsCloneCheckoutEnabled(
  settings: ForkApfsCloneSettings | undefined | null
): boolean {
  return settings?.forkApfsCloneCheckout === true
}

/**
 * One folder entry as a clean project-relative path with forward slashes, or null when it could
 * leave the project, names Git's own metadata, or is not a plain relative path.
 */
export function normalizeForkApfsCloneFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!trimmed || trimmed.length > MAX_FOLDER_LENGTH) {
    return null
  }
  // Control characters have no place in a folder name and would confuse logs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('~') || /^[A-Za-z]:/.test(trimmed)) {
    return null
  }
  const parts = trimmed.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.toLowerCase() === '.git') {
      return null
    }
  }
  return parts.join('/')
}

/** The folders to clone: the setting's valid entries, deduplicated, or the default when unset. */
export function forkApfsCloneFolders(settings: ForkApfsCloneSettings | undefined | null): string[] {
  const raw = settings?.forkApfsCloneFolders
  const list = Array.isArray(raw) ? raw : FORK_APFS_CLONE_DEFAULT_FOLDERS
  const out: string[] = []
  for (const entry of list) {
    const folder = normalizeForkApfsCloneFolder(entry)
    if (folder && !out.includes(folder)) {
      out.push(folder)
    }
    if (out.length >= FORK_APFS_CLONE_MAX_FOLDERS) {
      break
    }
  }
  return out
}

/** The Settings text field (commas or new lines between folders) to the saved list. */
export function parseForkApfsCloneFolderText(text: string): string[] {
  const out: string[] = []
  for (const entry of text.split(/[,\n]/)) {
    const folder = normalizeForkApfsCloneFolder(entry)
    if (folder && !out.includes(folder)) {
      out.push(folder)
    }
  }
  return out
}
