import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type XcodeProject = {
  parseSync(): XcodeProject
  pbxTargetByName(name: string): { buildPhases: { comment: string }[] } | null
  pbxXCBuildConfigurationSection(): Record<string, { buildSettings?: Record<string, string> }>
  hash: { project: { objects: Record<string, Record<string, unknown>> } }
  getFirstTarget(): { firstTarget: { buildPhases: { comment: string }[] } }
}
const xcode = require(
  createRequire(
    require.resolve('@expo/config-plugins', { paths: [require.resolve('expo')] })
  ).resolve('xcode')
) as { project(path: string): XcodeProject }
const plugin = require('../../../../plugins/fork/ios-agent-live-activity.js') as {
  internals: {
    TARGET: string
    addWidgetTarget(project: XcodeProject, options: { bundleId: string }): void
    appGroupFor(bundleId: string): string
    swiftSources(): { name: string }[]
    widgetEntitlements(group: string): string
    widgetInfoPlist(options: { version: string; buildNumber: string; appGroup: string }): string
    widgetsEnabled(env: Record<string, string | undefined>): boolean
  }
}
const { internals } = plugin

// The smallest project Expo's template resembles: one app target with its three phases.
const PROJECT = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {};
	objectVersion = 54;
	objects = {
/* Begin PBXBuildFile section */
		A00000000000000000000019 /* main.m in Sources */ = {isa = PBXBuildFile; fileRef = A0000000000000000000001A /* main.m */; };
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
		A0000000000000000000001A /* main.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; path = main.m; sourceTree = "<group>"; };
		A0000000000000000000000A /* Orca.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Orca.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */
/* Begin PBXFrameworksBuildPhase section */
		A0000000000000000000000B /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXFrameworksBuildPhase section */
/* Begin PBXGroup section */
		A0000000000000000000000C = {isa = PBXGroup; children = (A0000000000000000000000D /* Products */,); sourceTree = "<group>"; };
		A0000000000000000000000D /* Products */ = {isa = PBXGroup; children = (A0000000000000000000000A /* Orca.app */,); name = Products; sourceTree = "<group>"; };
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		A0000000000000000000000E /* Orca */ = {isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000010 /* Build configuration list for PBXNativeTarget "Orca" */; buildPhases = (A0000000000000000000000F /* Sources */, A0000000000000000000000B /* Frameworks */, A00000000000000000000011 /* Resources */, A00000000000000000000012 /* Bundle React Native code and images */,); buildRules = (); dependencies = (); name = Orca; productName = Orca; productReference = A0000000000000000000000A /* Orca.app */; productType = "com.apple.product-type.application"; };
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		A00000000000000000000013 /* Project object */ = {isa = PBXProject; buildConfigurationList = A00000000000000000000014 /* Build configuration list for PBXProject "Orca" */; compatibilityVersion = "Xcode 3.2"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,); mainGroup = A0000000000000000000000C; productRefGroup = A0000000000000000000000D /* Products */; projectDirPath = ""; projectRoot = ""; targets = (A0000000000000000000000E /* Orca */,); };
/* End PBXProject section */
/* Begin PBXResourcesBuildPhase section */
		A00000000000000000000011 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXResourcesBuildPhase section */
/* Begin PBXShellScriptBuildPhase section */
		A00000000000000000000012 /* Bundle React Native code and images */ = {isa = PBXShellScriptBuildPhase; buildActionMask = 2147483647; files = (); inputPaths = (); name = "Bundle React Native code and images"; outputPaths = (); runOnlyForDeploymentPostprocessing = 0; shellPath = /bin/sh; shellScript = "true"; };
/* End PBXShellScriptBuildPhase section */
/* Begin PBXSourcesBuildPhase section */
		A0000000000000000000000F /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000019 /* main.m in Sources */,); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
		A00000000000000000000015 /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {DEVELOPMENT_TEAM = TEAM123; PRODUCT_BUNDLE_IDENTIFIER = com.example.app; }; name = Debug; };
		A00000000000000000000016 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {DEVELOPMENT_TEAM = TEAM123; PRODUCT_BUNDLE_IDENTIFIER = com.example.app; }; name = Release; };
		A00000000000000000000017 /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Debug; };
		A00000000000000000000018 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Release; };
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
		A00000000000000000000010 /* Build configuration list for PBXNativeTarget "Orca" */ = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000015 /* Debug */, A00000000000000000000016 /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		A00000000000000000000014 /* Build configuration list for PBXProject "Orca" */ = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000017 /* Debug */, A00000000000000000000018 /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
/* End XCConfigurationList section */
	};
	rootObject = A00000000000000000000013 /* Project object */;
}
`

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(): XcodeProject {
  const dir = mkdtempSync(join(tmpdir(), 'blackfish-widget-'))
  dirs.push(dir)
  const file = join(dir, 'project.pbxproj')
  writeFileSync(file, PROJECT)
  return xcode.project(file).parseSync()
}

describe('ios-agent-live-activity plugin', () => {
  it('adds the extension once, signed with the app team, embedded right after Resources', () => {
    const xcodeProject = project()
    internals.addWidgetTarget(xcodeProject, { bundleId: 'com.example.app' })
    internals.addWidgetTarget(xcodeProject, { bundleId: 'com.example.app' })

    const targets = Object.values(xcodeProject.hash.project.objects.PBXNativeTarget!).filter(
      (value) => typeof value === 'object'
    )
    expect(targets).toHaveLength(2)
    expect(
      xcodeProject
        .pbxTargetByName(`"${internals.TARGET}"`)!
        .buildPhases.map((phase) => phase.comment)
    ).toEqual(['Sources', 'Frameworks', 'Resources'])
    expect(
      xcodeProject.getFirstTarget().firstTarget.buildPhases.map((phase) => phase.comment)
    ).toEqual([
      'Sources',
      'Frameworks',
      'Resources',
      'Embed Foundation Extensions',
      'Bundle React Native code and images'
    ])
    const widgetSettings = Object.values(xcodeProject.pbxXCBuildConfigurationSection())
      .map((config) => (typeof config === 'object' ? config.buildSettings : undefined))
      .filter(
        (settings) => settings?.PRODUCT_BUNDLE_IDENTIFIER === '"com.example.app.BlackfishWidgets"'
      )
    expect(widgetSettings).toHaveLength(2)
    for (const settings of widgetSettings) {
      expect(settings).toMatchObject({
        DEVELOPMENT_TEAM: 'TEAM123',
        IPHONEOS_DEPLOYMENT_TARGET: '16.4',
        INFOPLIST_FILE: '"BlackfishWidgets/BlackfishWidgets-Info.plist"',
        CODE_SIGN_ENTITLEMENTS: '"BlackfishWidgets/BlackfishWidgets.entitlements"'
      })
    }
  })

  it('compiles the shared model and the widget sources into the extension', () => {
    const names = internals.swiftSources().map((file) => file.name)
    expect(names).toContain('BlackfishAgentsModel.swift')
    expect(names).toContain('BlackfishWidgetsBundle.swift')
    expect(names).not.toContain('BlackfishLiveActivityModule.swift')
  })

  it('writes the App Group and the app version into the extension plists', () => {
    const group = internals.appGroupFor('com.example.app')
    expect(group).toBe('group.com.example.app.blackfish')
    const info = internals.widgetInfoPlist({ version: '1.2.3', buildNumber: '45', appGroup: group })
    expect(info).toContain('<string>com.apple.widgetkit-extension</string>')
    expect(info).toContain('<string>1.2.3</string>')
    expect(info).toContain('<string>45</string>')
    expect(internals.widgetEntitlements(group)).toContain(`<string>${group}</string>`)
  })

  it('is on unless BLACKFISH_IOS_WIDGETS is 0', () => {
    expect(internals.widgetsEnabled({})).toBe(true)
    expect(internals.widgetsEnabled({ BLACKFISH_IOS_WIDGETS: '0' })).toBe(false)
  })
})
