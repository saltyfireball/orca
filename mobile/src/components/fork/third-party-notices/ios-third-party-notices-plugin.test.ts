import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type XcodeProject = {
  parseSync(): XcodeProject
  hash: { project: { objects: Record<string, Record<string, unknown>> } }
}
const xcode = require(
  createRequire(
    require.resolve('@expo/config-plugins', { paths: [require.resolve('expo')] })
  ).resolve('xcode')
) as { project(path: string): XcodeProject }
const plugin = require('../../../../plugins/fork/ios-third-party-notices.js') as {
  internals: {
    NOTICES_FILE: string
    SOURCE: string
    addNoticesResource(project: XcodeProject, projectName: string): XcodeProject
  }
}
const { internals } = plugin

// An app target with a Resources phase and the app's own group, as Expo's template has.
const PROJECT = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {};
	objectVersion = 54;
	objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
		B0000000000000000000000A /* Example.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Example.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
		B0000000000000000000000C = {isa = PBXGroup; children = (B0000000000000000000000E /* Example */, B0000000000000000000000D /* Products */,); sourceTree = "<group>"; };
		B0000000000000000000000D /* Products */ = {isa = PBXGroup; children = (B0000000000000000000000A /* Example.app */,); name = Products; sourceTree = "<group>"; };
		B0000000000000000000000E /* Example */ = {isa = PBXGroup; children = (); name = Example; path = Example; sourceTree = "<group>"; };
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		B0000000000000000000000F /* Example */ = {isa = PBXNativeTarget; buildConfigurationList = B00000000000000000000010 /* Build configuration list for PBXNativeTarget "Example" */; buildPhases = (B00000000000000000000011 /* Resources */,); buildRules = (); dependencies = (); name = Example; productName = Example; productReference = B0000000000000000000000A /* Example.app */; productType = "com.apple.product-type.application"; };
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		B00000000000000000000013 /* Project object */ = {isa = PBXProject; buildConfigurationList = B00000000000000000000014 /* Build configuration list for PBXProject "Example" */; compatibilityVersion = "Xcode 3.2"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,); mainGroup = B0000000000000000000000C; productRefGroup = B0000000000000000000000D /* Products */; projectDirPath = ""; projectRoot = ""; targets = (B0000000000000000000000F /* Example */,); };
/* End PBXProject section */
/* Begin PBXResourcesBuildPhase section */
		B00000000000000000000011 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXResourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
		B00000000000000000000015 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Release; };
		B00000000000000000000016 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Release; };
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
		B00000000000000000000010 /* Build configuration list for PBXNativeTarget "Example" */ = {isa = XCConfigurationList; buildConfigurations = (B00000000000000000000015 /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		B00000000000000000000014 /* Build configuration list for PBXProject "Example" */ = {isa = XCConfigurationList; buildConfigurations = (B00000000000000000000016 /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
/* End XCConfigurationList section */
	};
	rootObject = B00000000000000000000013 /* Project object */;
}
`

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(): XcodeProject {
  const dir = mkdtempSync(join(tmpdir(), 'notices-xcode-'))
  dirs.push(dir)
  const file = join(dir, 'project.pbxproj')
  writeFileSync(file, PROJECT)
  return xcode.project(file).parseSync()
}

function entries(project: XcodeProject, section: string): Record<string, unknown>[] {
  return Object.values(project.hash.project.objects[section] ?? {}).filter(
    (value): value is Record<string, unknown> => typeof value === 'object'
  )
}

describe('ios-third-party-notices plugin', () => {
  it('puts the notices file in the app Resources phase once, however often prebuild runs', () => {
    const xcodeProject = project()
    internals.addNoticesResource(xcodeProject, 'Example')
    internals.addNoticesResource(xcodeProject, 'Example')

    const refs = entries(xcodeProject, 'PBXFileReference').filter((ref) =>
      String(ref.path).includes(internals.NOTICES_FILE)
    )
    expect(refs).toHaveLength(1)
    const [resources] = entries(xcodeProject, 'PBXResourcesBuildPhase')
    const files = resources.files as { comment: string }[]
    expect(files.map((file) => file.comment)).toEqual([`${internals.NOTICES_FILE} in Resources`])
  })

  it('ships the generated notices file that sits beside the plugin', () => {
    const text = readFileSync(internals.SOURCE, 'utf8')
    expect(text.startsWith('THIRD-PARTY NOTICES\n')).toBe(true)
    expect(text).toContain('Copyright (c) 2026 Lovecast Inc.')
  })
})
