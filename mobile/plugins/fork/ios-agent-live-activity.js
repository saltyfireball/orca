// Blackfish (SLRM-2387): adds the BlackfishWidgets extension (the agents widget and the agents Live
// Activity) to the iOS project at prebuild, and lets the app start Live Activities and share the
// widget's snapshot through an App Group. The Swift lives in modules/fork-live-activity: ios/shared
// is compiled into both targets, widget/ only into the extension.
//
// BLACKFISH_IOS_WIDGETS=0 at prebuild leaves the project as upstream builds it (no extension, no
// App Group), for a signing setup that has no provisioning profile for the extension.
const fs = require('node:fs')
const path = require('node:path')
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject
} = require('expo/config-plugins')

const TARGET = 'BlackfishWidgets'
const DEPLOYMENT_TARGET = '16.4'
const MODULE_ROOT = path.join(__dirname, '..', '..', 'modules', 'fork-live-activity')
const SHARED_DIR = path.join(MODULE_ROOT, 'ios', 'shared')
const WIDGET_DIR = path.join(MODULE_ROOT, 'widget')
const INFO_PLIST = `${TARGET}-Info.plist`
const ENTITLEMENTS = `${TARGET}.entitlements`
const APP_GROUPS = 'com.apple.security.application-groups'

function widgetsEnabled(env = process.env) {
  return env.BLACKFISH_IOS_WIDGETS !== '0'
}

function appGroupFor(bundleId) {
  return `group.${bundleId}.blackfish`
}

function swiftSources() {
  const list = (dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.swift'))
      .sort()
      .map((name) => ({ name, from: path.join(dir, name) }))
  return [...list(SHARED_DIR), ...list(WIDGET_DIR)]
}

function plistString(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The extension's Info.plist: versions match the app's, as App Store validation requires. */
function widgetInfoPlist({ version, buildNumber, appGroup }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>BlackfishAppGroup</key>
  <string>${plistString(appGroup)}</string>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Agents</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${plistString(version)}</string>
  <key>CFBundleVersion</key>
  <string>${plistString(buildNumber)}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`
}

function widgetEntitlements(appGroup) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>${APP_GROUPS}</key>
  <array>
    <string>${plistString(appGroup)}</string>
  </array>
</dict>
</plist>
`
}

function quoted(value) {
  return `"${value}"`
}

/** Build settings for the extension, signed like the app (same team and signing style). */
function widgetBuildSettings({ bundleId, appSettings }) {
  const settings = {
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    CODE_SIGN_ENTITLEMENTS: quoted(`${TARGET}/${ENTITLEMENTS}`),
    CODE_SIGN_STYLE: appSettings.CODE_SIGN_STYLE ?? 'Automatic',
    GENERATE_INFOPLIST_FILE: 'NO',
    INFOPLIST_FILE: quoted(`${TARGET}/${INFO_PLIST}`),
    IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
    LD_RUNPATH_SEARCH_PATHS: quoted(
      '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
    ),
    PRODUCT_BUNDLE_IDENTIFIER: quoted(bundleId),
    PRODUCT_NAME: quoted('$(TARGET_NAME)'),
    SDKROOT: 'iphoneos',
    SKIP_INSTALL: 'YES',
    SWIFT_VERSION: '5.0',
    TARGETED_DEVICE_FAMILY: quoted('1,2')
  }
  if (appSettings.DEVELOPMENT_TEAM) {
    settings.DEVELOPMENT_TEAM = appSettings.DEVELOPMENT_TEAM
  }
  return settings
}

function mainTargetBuildSettings(project, configName) {
  const appTarget = project.getFirstTarget().firstTarget
  const listId = appTarget.buildConfigurationList
  const list = project.pbxXCConfigurationList()[listId]
  const configs = project.pbxXCBuildConfigurationSection()
  const entry = list?.buildConfigurations.find((config) => config.comment === configName)
  return (entry && configs[entry.value]?.buildSettings) ?? {}
}

/** Adds the extension target once: its files, build phases, settings and the app's embed phase. */
function addWidgetTarget(project, { bundleId }) {
  // addTarget stores the name quoted; a second prebuild over the same ios folder must not add it again.
  if (project.pbxTargetByName(TARGET) || project.pbxTargetByName(quoted(TARGET))) {
    return
  }
  const objects = project.hash.project.objects
  // addTarget links the extension to the app through these; a fresh Expo project has neither.
  objects.PBXTargetDependency ??= {}
  objects.PBXContainerItemProxy ??= {}

  const sources = swiftSources().map((file) => file.name)
  const group = project.addPbxGroup([...sources, INFO_PLIST, ENTITLEMENTS], TARGET, TARGET)
  const mainGroupId = project.getFirstProject().firstProject.mainGroup
  project.addToPbxGroup(group.uuid, mainGroupId)

  const target = project.addTarget(TARGET, 'app_extension', TARGET, `${bundleId}.${TARGET}`)
  project.addBuildPhase(sources, 'PBXSourcesBuildPhase', 'Sources', target.uuid)
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)

  const configs = project.pbxXCBuildConfigurationSection()
  const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList]
  for (const { value, comment } of list.buildConfigurations) {
    const settings = widgetBuildSettings({
      bundleId: `${bundleId}.${TARGET}`,
      appSettings: mainTargetBuildSettings(project, comment)
    })
    configs[value].buildSettings = { ...configs[value].buildSettings, ...settings }
  }
  renameEmbedPhase(project)
}

// addTarget names the app's embed phase "Copy Files" and appends it last. Xcode's own template
// names it "Embed Foundation Extensions" and runs it before the script phases pods add later.
function renameEmbedPhase(project) {
  const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
  const appTarget = project.getFirstTarget().firstTarget
  const name = 'Embed Foundation Extensions'
  for (const [id, phase] of Object.entries(phases)) {
    if (
      typeof phase !== 'object' ||
      phase.name !== '"Copy Files"' ||
      phase.dstSubfolderSpec !== 13
    ) {
      continue
    }
    phase.name = quoted(name)
    phases[`${id}_comment`] = name
    const at = appTarget.buildPhases.findIndex((entry) => entry.value === id)
    if (at !== -1) {
      const [entry] = appTarget.buildPhases.splice(at, 1)
      const resources = appTarget.buildPhases.findIndex((other) => other.comment === 'Resources')
      appTarget.buildPhases.splice(resources + 1, 0, { ...entry, comment: name })
    }
  }
}

function withForkAgentLiveActivity(config) {
  if (!widgetsEnabled()) {
    return config
  }
  const bundleId = config.ios?.bundleIdentifier
  // It is written unescaped into plists and the project file, so it must be a plain bundle id.
  if (!bundleId || !/^[A-Za-z0-9.-]+$/.test(bundleId)) {
    throw new Error('ios-agent-live-activity: ios.bundleIdentifier must be a plain bundle id.')
  }
  const appGroup = appGroupFor(bundleId)

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true
    cfg.modResults.BlackfishAppGroup = appGroup
    return cfg
  })
  config = withEntitlementsPlist(config, (cfg) => {
    const groups = cfg.modResults[APP_GROUPS] ?? []
    cfg.modResults[APP_GROUPS] = groups.includes(appGroup) ? groups : [...groups, appGroup]
    return cfg
  })
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET)
      fs.mkdirSync(dir, { recursive: true })
      for (const file of swiftSources()) {
        fs.copyFileSync(file.from, path.join(dir, file.name))
      }
      fs.writeFileSync(
        path.join(dir, INFO_PLIST),
        widgetInfoPlist({
          version: cfg.version ?? '1.0.0',
          buildNumber: cfg.ios?.buildNumber ?? '1',
          appGroup
        })
      )
      fs.writeFileSync(path.join(dir, ENTITLEMENTS), widgetEntitlements(appGroup))
      return cfg
    }
  ])
  return withXcodeProject(config, (cfg) => {
    addWidgetTarget(cfg.modResults, { bundleId })
    return cfg
  })
}

module.exports = withForkAgentLiveActivity
module.exports.internals = {
  TARGET,
  addWidgetTarget,
  appGroupFor,
  swiftSources,
  widgetBuildSettings,
  widgetEntitlements,
  widgetInfoPlist,
  widgetsEnabled
}
