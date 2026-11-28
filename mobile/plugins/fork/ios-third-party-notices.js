// Blackfish (BAD-897, FORK.md "Third-party notices"): ships mobile/THIRD_PARTY_NOTICES.txt in the
// iOS app bundle at prebuild, where Settings > About reads it. Regenerate the file with
// `pnpm run notices:generate` from the repo root.
const fs = require('node:fs')
const path = require('node:path')
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins')

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'
const SOURCE = path.join(__dirname, '..', '..', NOTICES_FILE)

/** Adds the notices file to the app target's group and its Resources phase, once. */
function addNoticesResource(project, projectName) {
  IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath: path.join(projectName, NOTICES_FILE),
    groupName: projectName,
    project,
    isBuildFile: true
  })
  return project
}

function withForkThirdPartyNotices(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot)
      const dir = path.join(cfg.modRequest.platformProjectRoot, projectName)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(SOURCE, path.join(dir, NOTICES_FILE))
      return cfg
    }
  ])
  return withXcodeProject(config, (cfg) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot)
    addNoticesResource(cfg.modResults, projectName)
    return cfg
  })
}

module.exports = withForkThirdPartyNotices
module.exports.internals = { NOTICES_FILE, SOURCE, addNoticesResource }
