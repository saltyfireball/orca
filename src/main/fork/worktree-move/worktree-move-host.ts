// SLRM-2265: the workspace move service wired to this process's runtime, git, chat host and file
// system. Every runtime (this desktop, a paired server, orcad) builds its own, so each half of a
// move runs on the host that owns that workspace.
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitExecFileAsync, gitExecFileAsyncBuffer } from '../../git/command-runner/git-exec-file'
import { getSystemCodexHomePath } from '../../codex/configuration/homes/codex-home-paths'
import { resolveSessionFilePath } from '../../native-chat/session-file-resolver'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { isWslPath } from '../../wsl/filesystem/unc-path-access'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { forkStopChatTurn } from '../chat-host-turn-stop'
import { WorktreeMoveService, type WorktreeMoveFs } from './worktree-move-service'

const CALLER_KEY = 'trusted-local:fork-worktree-move'
/** Patches and transcripts can be large; git's default output cap is 10 MB. */
const MAX_GIT_BUFFER = 80 * 1024 * 1024

const nodeFs: WorktreeMoveFs = {
  size: async (path) => {
    try {
      return (await stat(path)).size
    } catch {
      return null
    }
  },
  read: (path) => readFile(path),
  write: async (path, data) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data, { mode: 0o600 })
  },
  exists: async (path) => (await stat(path).catch(() => null)) !== null,
  rename: (from, to) => rename(from, to),
  copy: (from, to) => copyFile(from, to),
  tempDir: () => mkdtemp(join(tmpdir(), 'orca-worktree-move-')),
  remove: (path) => rm(path, { recursive: true, force: true })
}

export function worktreeMoveService(runtime: OrcaRuntimeService): WorktreeMoveService {
  const host = getStructuredAgentSessionHost()
  return new WorktreeMoveService({
    fs: nodeFs,
    home: () => homedir(),
    claudeHome: () => join(homedir(), '.claude'),
    codexHome: () => getSystemCodexHomePath(),
    now: () => new Date(),
    showWorktree: (selector) => runtime.showManagedWorktree(selector),
    git: async (args, options) =>
      (await gitExecFileAsync(args, { ...options, maxBuffer: MAX_GIT_BUFFER })).stdout,
    gitBuffer: async (args, options) =>
      (await gitExecFileAsyncBuffer(args, { ...options, maxBuffer: MAX_GIT_BUFFER })).stdout,
    records: () => host?.deps.store.listRecords() ?? [],
    summary: (sessionId) => host?.readStatusSummary(sessionId),
    stopTurn: async (sessionId) => (host ? forkStopChatTurn(host, sessionId, CALLER_KEY) : false),
    findTranscript: (agent, providerSessionId, cwd) =>
      resolveSessionFilePath(agent, providerSessionId, agent === 'claude' ? { cwd } : {}),
    isWslPath,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms))
  })
}
