// Set up on a server (FORK.md, SLRM-2312): what the server itself answers. `plan` turns the
// desktop's parent folder setting into an absolute folder here (`~` is this machine's home) and
// says whether the clone folder is free; `readiness` runs the environment doctor on the new
// checkout and checks its .envrc against this machine's direnv. Tests pass fake deps.
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { access, readdir, readFile } from 'node:fs/promises'
import type { EnvironmentDoctorResult } from '../../../shared/workspace-setup/environment-doctor/environment-doctor-types'
import {
  checkForkCloneUrl,
  checkForkSetupParent,
  forkEnvrcReadiness,
  type ForkServerSetupReadiness
} from '../../../shared/fork/server-setup'
import type { ForkServerSetupPlan } from '../../../shared/fork/server-setup-wire'
import { deriveValidatedClonePath } from '../../git/repositories/cloning/repo-clone-path'

/** direnv rc text read per check; more than this is not a direnvrc anyone wrote by hand. */
const RC_MAX_BYTES = 256 * 1024
const RC_LIB_MAX_FILES = 64

export type ForkServerSetupHostDeps = {
  home: () => string
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string | null>
  listDir: (path: string) => Promise<string[]>
  env: () => NodeJS.ProcessEnv
  runDoctor: (path: string) => Promise<EnvironmentDoctorResult>
  findCommands: (commands: readonly string[]) => Promise<Set<string>>
}

/** `~` and `~/x` against this machine's home, then absolute and normalized; null otherwise. */
export function expandForkSetupParent(raw: string, home: string): string | null {
  const parent = checkForkSetupParent(raw)
  if (!parent || !home) {
    return null
  }
  const expanded =
    parent === '~' ? home : parent.startsWith('~/') ? join(home, parent.slice(2)) : parent
  return isAbsolute(expanded) ? resolve(expanded) : null
}

export async function planForkServerSetup(
  params: { url: string; parent: string },
  deps: Pick<ForkServerSetupHostDeps, 'home' | 'exists'>
): Promise<ForkServerSetupPlan> {
  // Checked again here: the server never trusts the caller's checks.
  const url = checkForkCloneUrl(params.url)
  if (!url.ok) {
    throw new Error(url.reason)
  }
  const destination = expandForkSetupParent(params.parent, deps.home())
  if (!destination) {
    throw new Error('The folder to clone into must be an absolute path or start with ~/.')
  }
  const clonePath = deriveValidatedClonePath({ url: url.url, destination })
  const folderName = clonePath.slice(destination.length).replace(/^[\\/]+/, '')
  return { destination, folderName, clonePath, exists: await deps.exists(clonePath) }
}

/** Every direnv rc this machine's direnv would load: direnvrc, ~/.direnvrc and lib/*.sh. */
async function readDirenvRc(deps: ForkServerSetupHostDeps): Promise<string> {
  const env = deps.env()
  const home = deps.home()
  const configDir =
    env.DIRENV_CONFIG?.trim() ||
    join(env.XDG_CONFIG_HOME?.trim() || join(home, '.config'), 'direnv')
  const libDir = join(configDir, 'lib')
  const libFiles = (await deps.listDir(libDir))
    .filter((name) => name.endsWith('.sh'))
    .sort()
    .slice(0, RC_LIB_MAX_FILES)
    .map((name) => join(libDir, name))
  const paths = [join(configDir, 'direnvrc'), join(home, '.direnvrc'), ...libFiles]
  const texts = await Promise.all(paths.map((path) => deps.readText(path)))
  return texts.filter((text): text is string => text !== null).join('\n')
}

/** Tools the doctor found missing, then direnv's part. */
export async function readForkServerSetupReadiness(
  path: string,
  deps: ForkServerSetupHostDeps
): Promise<ForkServerSetupReadiness> {
  if (!isAbsolute(path)) {
    throw new Error('Readiness needs the absolute path of the checkout.')
  }
  const doctor = await deps.runDoctor(path)
  const missing = doctor.checks
    .filter((check) => check.category === 'tools' && check.status === 'fail')
    .map((check) => check.message)
  const notes = doctor.checks
    .filter((check) => check.category === 'setup' && check.status !== 'pass')
    .map((check) => check.message)
  const envrc = await deps.readText(join(doctor.worktreePath || path, '.envrc'))
  const direnv =
    envrc === null
      ? { missing: [], notes: [] }
      : forkEnvrcReadiness({
          envrc,
          direnvFound: (await deps.findCommands(['direnv'])).has('direnv'),
          direnvRc: await readDirenvRc(deps)
        })
  return { missing: [...missing, ...direnv.missing], notes: [...notes, ...direnv.notes] }
}

async function readCapped(path: string): Promise<string | null> {
  const text = await readFile(path, 'utf8').catch(() => null)
  return text === null ? null : text.slice(0, RC_MAX_BYTES)
}

/** Real host I/O; the doctor's own deps come from the caller so this file stays light. */
export function createForkServerSetupHostDeps(
  doctor: Pick<ForkServerSetupHostDeps, 'runDoctor' | 'findCommands'>
): ForkServerSetupHostDeps {
  return {
    home: () => homedir(),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false
      ),
    readText: readCapped,
    listDir: (path) => readdir(path).catch((): string[] => []),
    env: () => process.env,
    ...doctor
  }
}
