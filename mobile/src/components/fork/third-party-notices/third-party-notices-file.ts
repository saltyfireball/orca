// Third-party notices (BAD-897, FORK.md "Third-party notices"): the file the iOS plugin
// (plugins/fork/ios-third-party-notices.js) puts in the app bundle. Other builds do not ship it.
import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'

export function thirdPartyNoticesShipped(): boolean {
  return Platform.OS === 'ios'
}

/** The bundled notices, or null when this build has none. */
export async function readThirdPartyNotices(): Promise<string | null> {
  const file = new File(Paths.bundle, NOTICES_FILE)
  return file.exists ? file.text() : null
}

/** Blocks of the file split at blank lines, so a long list renders a screenful at a time. */
export function thirdPartyNoticeBlocks(text: string): string[] {
  return text.split(/\n{2,}/).filter((block) => block.trim() !== '')
}
