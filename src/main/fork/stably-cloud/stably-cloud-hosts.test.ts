// Upstream cloud switch (BAD-896): a new upstream host that lands in the main process (a merge from
// upstream) must come under the switch. Every main-process file that names an upstream host must
// be one of the files below, and each of them must consult the switch.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
// Covered services: sign-in and relay director (auth config), share links, push gateway,
// connector, what's-new nudge and changelog, plugin install counts and safety list.
const COVERED = new Map<string, string>([
  ['src/main/artifacts/artifact-cloud-config.ts', 'assertForkStablyCloudOn'],
  ['src/main/connector-cloud/connector-origin.ts', ''],
  [
    'src/main/orca-profiles/cloud-auth/profile-cloud-auth-config.ts',
    'currentForkStablyCloudEnabled'
  ],
  ['src/main/plugins/catalog/plugin-install-stats-service.ts', 'assertForkStablyCloudOn'],
  ['src/main/plugins/catalog/plugin-kill-list-service.ts', 'assertForkStablyCloudOn'],
  ['src/main/runtime/push/push-gateway-origin.ts', ''],
  ['src/main/updater/nudges/nudge-campaign.ts', 'currentForkStablyCloudEnabled'],
  ['src/main/updater/releases/updater-changelog.ts', 'currentForkStablyCloudEnabled']
])
// Their origins are only read behind a gate elsewhere: the connector through the auth config
// (connector-cloud-install.ts) and the push gateway through the push start-up and client.
const GATED_ELSEWHERE: Record<string, string> = {
  'src/main/connector-cloud/connector-origin.ts':
    'src/main/connector-cloud/connector-cloud-install.ts',
  'src/main/runtime/push/push-gateway-origin.ts': 'src/main/runtime/push/push-gateway-client.ts'
}
const HOST = /https?:\/\/[a-z0-9.-]*(?:onorca\.dev|orca\.dev)\b/

function filesNamingAnUpstreamHost(): string[] {
  const listed = execFileSync('git', ['ls-files', 'src/main'], { cwd: ROOT, encoding: 'utf8' })
  return listed
    .split('\n')
    .filter(
      (file) => /\.tsx?$/.test(file) && !/\.(test|fixture)\.|test-fixture|__fixtures__/.test(file)
    )
    .filter((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .some((line) => HOST.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
    )
}

describe('upstream hosts in the main process', () => {
  it('are named only by files that sit behind the switch', () => {
    expect(filesNamingAnUpstreamHost().toSorted()).toEqual([...COVERED.keys()].toSorted())
  })

  it('each consult the switch, or are read only by a file that does', () => {
    for (const [file, marker] of COVERED) {
      const reader = GATED_ELSEWHERE[file] ?? file
      const text = readFileSync(join(ROOT, reader), 'utf8')
      expect(text, reader).toMatch(
        /currentForkStablyCloudEnabled|assertForkStablyCloudOn|forkStablyCloudFetch|getOrcaCloudAuthConfig/
      )
      if (marker) {
        expect(text, file).toContain(marker)
      }
    }
  })
})
