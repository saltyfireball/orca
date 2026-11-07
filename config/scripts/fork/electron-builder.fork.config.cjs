// Fork identity over the upstream builder config: own bundle id, name and userData so the fork
// installs beside stock Orca, and its update metadata points at the fork's releases (FORK.md).
// Keep FORK_RELEASE_OWNER in sync with src/shared/fork/fork-release-repo.ts.
const upstream = require('../../electron-builder.config.cjs')

const FORK_RELEASE_OWNER = 'saltyfireball'
const FORK_PRODUCT_NAME = 'Orca Fork'

/** @type {import('electron-builder').Configuration} */
module.exports = {
  ...upstream,
  appId: 'com.saltyfireball.orca',
  productName: FORK_PRODUCT_NAME,
  extraMetadata: { ...upstream.extraMetadata, productName: FORK_PRODUCT_NAME },
  publish: { ...upstream.publish, owner: FORK_RELEASE_OWNER }
}
