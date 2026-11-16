// SLRM-2265: the target host's half of a workspace move. Applies the carried patch in the new
// workspace and files each transcript, its paths rewritten, where this host's provider store
// looks for it, so `agentSession.create` with `resumeFrom` adopts it with its history.
import { basename, join } from 'node:path'
import { encodeClaudeProjectPath } from '../../ai-vault/scanners/claude/claude-project-dir-encoding'
import {
  createTranscriptPathRewriter,
  worktreeMoveRewrites
} from '../../../shared/fork/worktree-move/transcript-path-rewrite'
import type {
  WorktreeMoveImportResult,
  WorktreeMoveTranscriptWire
} from '../../../shared/fork/worktree-move/worktree-move-wire'
import type { WorktreeMoveFs } from './worktree-move-service'

export type WorktreeMoveImportDeps = {
  fs: WorktreeMoveFs
  home(): string
  /** The Claude home whose `projects` this host's adoption searches. */
  claudeHome(): string
  /** The Codex home whose `sessions` this host's adoption searches. */
  codexHome(): string
  now(): Date
}

export type WorktreeMoveImportParams = {
  worktree: string
  patch?: string
  sourcePath: string
  sourceHome: string
  rewriteHome?: boolean
  transcripts?: WorktreeMoveTranscriptWire[]
}

type RunGit = (args: string[], cwd: string) => Promise<string>

const CLAUDE_FILE = /^[A-Za-z0-9._-]+\.jsonl$/
const CODEX_REL = /^(?:\d{4}\/\d{2}\/\d{2}\/)?[A-Za-z0-9._-]+\.jsonl$/

/** Where a carried transcript goes on this host; null for a name that could leave the store. */
export function worktreeMoveTranscriptDestination(
  deps: Pick<WorktreeMoveImportDeps, 'claudeHome' | 'codexHome'>,
  transcript: Pick<WorktreeMoveTranscriptWire, 'agent' | 'relPath'>,
  targetPath: string
): string | null {
  if (transcript.agent === 'claude') {
    return CLAUDE_FILE.test(transcript.relPath)
      ? join(deps.claudeHome(), 'projects', encodeClaudeProjectPath(targetPath), transcript.relPath)
      : null
  }
  return CODEX_REL.test(transcript.relPath)
    ? join(deps.codexHome(), 'sessions', ...transcript.relPath.split('/'))
    : null
}

async function applyPatch(
  deps: WorktreeMoveImportDeps,
  patch: string,
  cwd: string,
  git: RunGit
): Promise<WorktreeMoveImportResult['patch']> {
  const dir = await deps.fs.tempDir()
  const file = join(dir, 'changes.patch')
  const data = Buffer.from(patch, 'base64')
  await deps.fs.write(file, data)
  try {
    await git(['apply', '--binary', '--whitespace=nowarn', file], cwd)
    return { kind: 'applied' }
  } catch (error) {
    // Keep the changes where the user can find them; the source still has them too.
    const gitDir = (await git(['rev-parse', '--absolute-git-dir'], cwd)).trim()
    const savedTo = join(gitDir, `orca-worktree-move-${deps.now().getTime()}.patch`)
    await deps.fs.write(savedTo, data)
    return {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error),
      savedTo
    }
  } finally {
    await deps.fs.remove(dir)
  }
}

export async function worktreeMoveImport(
  deps: WorktreeMoveImportDeps,
  params: WorktreeMoveImportParams,
  targetPath: string,
  git: RunGit
): Promise<WorktreeMoveImportResult> {
  const patch = params.patch
    ? await applyPatch(deps, params.patch, targetPath, git)
    : { kind: 'none' as const }
  const rewrite = createTranscriptPathRewriter(
    worktreeMoveRewrites({
      sourcePath: params.sourcePath,
      targetPath,
      sourceHome: params.sourceHome,
      targetHome: deps.home(),
      rewriteHome: params.rewriteHome !== false
    })
  )
  const transcripts: WorktreeMoveImportResult['transcripts'] = []
  for (const transcript of params.transcripts ?? []) {
    const entry = {
      sessionId: transcript.sessionId,
      providerSessionId: transcript.providerSessionId,
      agent: transcript.agent
    }
    const destination = worktreeMoveTranscriptDestination(deps, transcript, targetPath)
    if (!destination) {
      transcripts.push({
        ...entry,
        written: false,
        reason: 'its file name is not a transcript name'
      })
      continue
    }
    try {
      if (await deps.fs.exists(destination)) {
        // A copy from an earlier move or a shared store: keep it beside, never overwrite it silently.
        await deps.fs.rename(destination, `${destination}.before-move-${deps.now().getTime()}`)
      }
      const text = Buffer.from(transcript.content, 'base64').toString('utf8')
      await deps.fs.write(destination, rewrite(text))
      transcripts.push({ ...entry, written: true })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      transcripts.push({ ...entry, written: false, reason: `${basename(destination)}: ${reason}` })
    }
  }
  return { patch, transcripts }
}
