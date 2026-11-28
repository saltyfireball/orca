// window.api.forkThirdPartyNotices.open in main (FORK.md "Third-party notices"): opens the notices
// file the bundle ships in its resources folder with the system's text viewer.
import { access } from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import {
  FORK_THIRD_PARTY_NOTICES_CHANNELS,
  THIRD_PARTY_NOTICES_FILE,
  type ForkThirdPartyNoticesOpenResult
} from '../../../shared/fork/third-party-notices'

type NoticesLocation = {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  cwd: string
}

/** The notices file: the resources folder when packaged, else the repository root of a dev run. */
export async function thirdPartyNoticesPath(location: NoticesLocation): Promise<string | null> {
  const candidates = location.isPackaged
    ? [location.resourcesPath]
    : [location.appPath, path.resolve(location.appPath, '..', '..'), location.cwd]
  for (const dir of candidates) {
    const file = path.join(dir, THIRD_PARTY_NOTICES_FILE)
    try {
      await access(file)
      return file
    } catch {
      // Not in this folder; try the next.
    }
  }
  return null
}

export async function openThirdPartyNotices(
  location: NoticesLocation,
  openPath: (file: string) => Promise<string>
): Promise<ForkThirdPartyNoticesOpenResult> {
  const file = await thirdPartyNoticesPath(location)
  if (!file) {
    return { ok: false, error: `${THIRD_PARTY_NOTICES_FILE} is not in this build.` }
  }
  const error = await openPath(file)
  return error ? { ok: false, error } : { ok: true }
}

let installed = false

export function installForkThirdPartyNoticesBridge(): void {
  if (installed) {
    return
  }
  installed = true
  ipcMain.handle(FORK_THIRD_PARTY_NOTICES_CHANNELS.open, () =>
    openThirdPartyNotices(
      {
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        cwd: process.cwd()
      },
      (file) => shell.openPath(file)
    )
  )
}
