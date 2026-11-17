import { describe, expect, it } from 'vitest'
import { findForkServerInstall, splitSystemdWords } from './server-update-install'

// The LaunchAgent dotfiles orca-server writes: a wait for the bind address, then the launcher.
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stablyai.orca.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>addr=$1; shift; exec "$@"</string>
    <string>orca-server-wait</string>
    <string>100.64.0.5</string>
    <string>/Applications/Blackfish.app/Contents/Resources/bin/orca</string>
    <string>serve</string>
    <string>--supervise</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin</string>
    <key>ORCA_USER_DATA_PATH</key>
    <string>/Users/a/Library/Application Support/orca</string>
  </dict>
</dict>
</plist>
`

const UNIT = `[Service]
ExecStart=/home/a/.local/share/orca-server/bin/orca-ide serve --supervise --no-pairing --port 6768
Environment="PATH=/usr/bin:/bin"
Environment="ORCA_USER_DATA_PATH=/home/a/.config/orca"
KillMode=process
`

function fakeFs(files: Record<string, string>) {
  return {
    readDir: async (dir: string) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    readFile: async (path: string) => {
      const text = files[path]
      if (text === undefined) {
        throw new Error('ENOENT')
      }
      return text
    }
  }
}

describe('findForkServerInstall', () => {
  it("finds the app a LaunchAgent for this profile runs, through orca-server's wrapper", async () => {
    const found = await findForkServerInstall({
      platform: 'darwin',
      homeDir: '/Users/a',
      userDataPath: '/Users/a/Library/Application Support/orca',
      ...fakeFs({ '/Users/a/Library/LaunchAgents/com.stablyai.orca.serve.plist': PLIST })
    })
    expect(found).toEqual({
      kind: 'mac-app',
      path: '/Applications/Blackfish.app',
      service: {
        manager: 'launchd',
        name: 'com.stablyai.orca.serve',
        unitPath: '/Users/a/Library/LaunchAgents/com.stablyai.orca.serve.plist'
      }
    })
  })

  it('finds the unpacked Linux server a systemd user unit runs', async () => {
    const found = await findForkServerInstall({
      platform: 'linux',
      homeDir: '/home/a',
      userDataPath: '/home/a/.config/orca',
      ...fakeFs({ '/home/a/.config/systemd/user/orca-serve.service': UNIT })
    })
    expect(found).toMatchObject({
      kind: 'linux-server',
      path: '/home/a/.local/share/orca-server',
      service: { manager: 'systemd', name: 'orca-serve.service' }
    })
  })

  it("never picks another profile's service", async () => {
    const found = await findForkServerInstall({
      platform: 'linux',
      homeDir: '/home/a',
      userDataPath: '/home/a/other-profile',
      ...fakeFs({ '/home/a/.config/systemd/user/orca-serve.service': UNIT })
    })
    expect(found).toHaveProperty('problem')
  })

  it('splits systemd words the way systemd quotes them', () => {
    expect(splitSystemdWords('"/a b/orca-ide" serve "--x=1 %%" \'q "r\'')).toEqual([
      '/a b/orca-ide',
      'serve',
      '--x=1 %',
      'q "r'
    ])
  })
})
