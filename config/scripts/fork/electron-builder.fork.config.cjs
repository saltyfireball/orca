// Fork identity over the upstream builder config: own bundle id, name and userData so the fork
// installs beside stock Orca, and its update metadata points at the fork's releases (FORK.md).
// Keep FORK_RELEASE_OWNER in sync with src/shared/fork/fork-release-repo.ts.
const upstream = require('../../electron-builder.config.cjs')

const FORK_RELEASE_OWNER = 'saltyfireball'
const FORK_PRODUCT_NAME = 'Orca Fork'
// The fork ships Apple Silicon only: an x64 slice must boot its terminal host under Rosetta,
// which the fork's runners and Macs do not need.
const FORK_MAC_ARCH = ['arm64']

/** @type {import('electron-builder').Configuration} */
module.exports = {
  ...upstream,
  appId: 'com.saltyfireball.orca',
  productName: FORK_PRODUCT_NAME,
  extraMetadata: { ...upstream.extraMetadata, productName: FORK_PRODUCT_NAME },
  mac: {
    ...upstream.mac,
    target: upstream.mac.target.map((entry) =>
      typeof entry === 'string'
        ? { target: entry, arch: FORK_MAC_ARCH }
        : { ...entry, arch: FORK_MAC_ARCH }
    )
  },
  publish: { ...upstream.publish, owner: FORK_RELEASE_OWNER }
}
