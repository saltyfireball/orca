// The fork ships as "Blackfish" (productName, so Blackfish.app and the name shown after ready), but
// keeps the data folder and Keychain item it had as "Orca Fork", so a rename never loses settings,
// chats or saved secrets (FORK.md).

/** productName in config/scripts/fork/electron-builder.fork.config.cjs; Electron's default userData basename. */
export const FORK_PRODUCT_NAME = 'Blackfish'
/** The fork's own data folder under appData, pinned from before the rename. */
export const FORK_DATA_DIR_NAME = 'Orca Fork'
/** Pre-ready name in own mode: it fixes the Keychain service, "Orca Fork Safe Storage". */
export const FORK_PRE_READY_APP_NAME = 'Orca Fork'

/**
 * The name to set after ready, when the Keychain service and userData are already fixed. Packaged
 * builds show "Blackfish" in the window title, menu and About panel; dev keeps its own identity.
 */
export function forkPostReadyAppName(identity: { isDev: boolean; appName: string }): string {
  return identity.isDev ? identity.appName : FORK_PRODUCT_NAME
}
