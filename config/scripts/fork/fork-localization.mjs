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

/** True for a repo-relative, slash-separated path inside a fork folder. */
export function isForkLocalizedSource(relativePath) {
  return FORK_LOCALIZED_SOURCE_DIRS.some((dir) => relativePath.startsWith(`${dir}/`))
}
