// BAD-816: ajv is compiled into main and carries `require("ajv/...")` text inside its code strings.
// The packaged import check passes those, and still fails a real require of ajv or of any other
// package without copied node_modules, in a string or not. Faked: the asar reader.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { verifyPackagedMainRuntimeDeps } = createRequire(import.meta.url)(
  '../../packaged-runtime-node-modules.cjs'
)

let resources
beforeEach(() => {
  resources = mkdtempSync(join(tmpdir(), 'packaged-ajv-'))
  writeFileSync(join(resources, 'app.asar'), '')
})
afterEach(() => rmSync(resources, { recursive: true, force: true }))

function verify(chunk) {
  const files = {
    '/out/main/index.js': '',
    '/out/main/agent-hooks/installation/managed-agent-hook-controls.js': '',
    '/out/main/chunks/chunk.js': chunk
  }
  return () =>
    verifyPackagedMainRuntimeDeps(resources, {
      listPackage: () => Object.keys(files),
      extractFile: (_asar, path) => Buffer.from(files[`/${path}`])
    })
}

describe('packaged import check and ajv', () => {
  it('passes the code strings ajv carries', () => {
    expect(verify('t.code=`require("ajv/dist/runtime/equal").default`')).not.toThrow()
    expect(verify(`e.code='require("ajv/dist/runtime/uri").default'`)).not.toThrow()
  })

  it('fails a real require of ajv and a code string of any other package', () => {
    expect(verify('const a=require("ajv")')).toThrow(/ajv/)
    expect(verify('const a=require("ajv/dist/runtime/equal")')).toThrow(/ajv/)
    expect(verify('t.code=`require("left-pad")`')).toThrow(/left-pad/)
  })
})
