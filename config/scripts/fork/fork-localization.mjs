// Fork UI strings stay out of upstream's en.json catalogs, so the daily rebase never conflicts
// there. Their English is the inline fallback each t() call carries, which is what renders: neither
// the desktop nor the mobile runtime loads en.json (it is the translators' source for the other
// locales, and those fall back to the inline English for keys they lack). Upstream's catalog
// verifiers skip these folders through one hook, and fork-localization.test.mjs checks the fork
// strings in their place.
export const FORK_LOCALIZED_SOURCE_DIRS = [
  'src/shared/fork',
  'src/main/fork',
  'src/main/updater/fork',
  'src/renderer/src/components/native-chat/fork',
  'src/renderer/src/fork',
  'mobile/src/components/fork'
]

// Upstream 1.4.261 put its own conversation-fork files (the "Fork" name mark) in
// native-chat/fork. They are upstream's, with en.json entries, so its verifiers keep them.
const NATIVE_CHAT_FORK_DIR = 'src/renderer/src/components/native-chat/fork'
export const UPSTREAM_SOURCES_IN_FORK_DIRS = [
  `${NATIVE_CHAT_FORK_DIR}/ForkMarkedName.tsx`,
  `${NATIVE_CHAT_FORK_DIR}/fork-marked-name-text.ts`
]

/** True for a repo-relative, slash-separated path inside a fork folder. */
export function isForkLocalizedSource(relativePath) {
  return (
    FORK_LOCALIZED_SOURCE_DIRS.some((dir) => relativePath.startsWith(`${dir}/`)) &&
    !UPSTREAM_SOURCES_IN_FORK_DIRS.includes(relativePath)
  )
}

/** i18next-cli ignore globs: every fork folder, but only the fork's own files in native-chat/fork. */
export const FORK_LOCALIZED_IGNORE_GLOBS = FORK_LOCALIZED_SOURCE_DIRS.flatMap((dir) =>
  dir === NATIVE_CHAT_FORK_DIR
    ? [`${dir}/NativeChatRun*`, `${dir}/native-chat-run-*`]
    : [`${dir}/**`]
)
