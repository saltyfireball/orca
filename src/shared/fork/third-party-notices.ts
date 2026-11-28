// Third-party notices (BAD-897, FORK.md "Third-party notices"): the file name the app bundle ships
// in its resources folder (config/scripts/fork/electron-builder.fork.config.cjs) and the bridge that
// opens it from Settings > Blackfish > About.
export const THIRD_PARTY_NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'

export const FORK_THIRD_PARTY_NOTICES_CHANNELS = {
  open: 'fork:thirdPartyNotices:open'
} as const

export type ForkThirdPartyNoticesOpenResult = { ok: true } | { ok: false; error: string }

export type ForkThirdPartyNoticesApi = {
  open: () => Promise<ForkThirdPartyNoticesOpenResult>
}
