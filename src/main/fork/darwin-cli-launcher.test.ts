import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The packaged `orca` CLI launcher must run the bundle's real executable, which is named after
// productName: Blackfish in the fork, Orca in stock builds (SLRM-1370).
const execFileAsync = promisify(execFile)
const launcherAsset = new URL('../../../resources/darwin/bin/orca', import.meta.url)
const itOnMac = process.platform === 'darwin' ? it : it.skip
const itOnUnix = process.platform === 'win32' ? it.skip : it

let root: string

beforeEach(async () => {
  // The launcher resolves the bundle with cd -P, so compare against the real path (/private/var on macOS).
  root = await realpath(await mkdtemp(join(tmpdir(), 'fork-cli-launcher-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function stageApp(bundle: string, executable: string, plistExecutable: string | null) {
  const contents = join(root, bundle, 'Contents')
  const launcher = join(contents, 'Resources', 'bin', 'orca')
  await mkdir(join(contents, 'Resources', 'bin'), { recursive: true })
  await mkdir(join(contents, 'MacOS'), { recursive: true })
  await copyFile(launcherAsset, launcher)
  await writeFile(
    join(contents, 'MacOS', executable),
    `#!/usr/bin/env bash\necho "${executable} $ELECTRON_RUN_AS_NODE $*"\n`,
    { mode: 0o755 }
  )
  if (plistExecutable !== null) {
    await writeFile(
      join(contents, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${plistExecutable}</string></dict></plist>
`
    )
  }
  return {
    launcher,
    cli: join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js')
  }
}

describe('darwin CLI launcher', () => {
  itOnMac("runs the executable Info.plist names, so Blackfish's CLI works", async () => {
    const { launcher, cli } = await stageApp('Blackfish.app', 'Blackfish', 'Blackfish')
    const { stdout } = await execFileAsync(launcher, ['status'])
    expect(stdout.trim()).toBe(`Blackfish 1 ${cli} status`)
  })

  itOnUnix('falls back to Orca without a usable CFBundleExecutable', async () => {
    const { launcher, cli } = await stageApp('Orca.app', 'Orca', null)
    expect((await execFileAsync(launcher, ['status'])).stdout.trim()).toBe(`Orca 1 ${cli} status`)
  })

  itOnMac('ignores an executable name that would leave Contents/MacOS', async () => {
    const { launcher, cli } = await stageApp('Orca.app', 'Orca', '../Resources/bin/orca')
    expect((await execFileAsync(launcher, ['status'])).stdout.trim()).toBe(`Orca 1 ${cli} status`)
  })
})
