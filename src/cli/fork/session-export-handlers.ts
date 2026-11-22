// Session export (FORK.md, BAD-688): `orca agent export`, through the host's
// fork.sessionExport.read RPC. Rendering and redaction run here, so one file comes out the same
// from any host; --share then publishes the file through the artifacts RPC.
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { rejectRemoteSelectionFlags } from '../dispatch/remote-selection-flag-rejection'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ArtifactCloudOperation, ArtifactListItem } from '../../shared/artifacts/artifacts'
import {
  ARTIFACT_SHARING_DISABLED_CODE,
  ARTIFACT_SHARING_DISABLED_MESSAGE,
  ARTIFACT_SHARING_DISABLED_NEXT_STEPS
} from '../../shared/artifacts/artifact-sharing-gate'
import {
  isSessionExportFormat,
  readSessionExportSettings,
  SESSION_EXPORT_FORMATS,
  type SessionExportDocument,
  type SessionExportFormat,
  type SessionExportSettingsSource
} from '../../shared/fork/session-export/session-export'
import { redactSessionExport } from '../../shared/fork/session-export/session-export-redact'
import {
  renderSessionExport,
  SESSION_EXPORT_FILE_EXTENSION
} from '../../shared/fork/session-export/session-export-render'

const SHARE_WARNING =
  'Anyone with this link can read the session. It was redacted, but read it before you pass the link on.'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no session export. Update Orca on that host and try again.'
    )
  }
  throw error
}

function flag(ctx: HandlerContext, name: string): boolean {
  return ctx.flags.get(name) === true
}

/** The id's tail, for a file name that is safe on every platform. */
function fileStem(id: string): string {
  const tail = id.replace(/^orca_session_id:/, '').replace(/[^A-Za-z0-9_-]/g, '')
  return `orca-session-${tail.slice(0, 8) || 'export'}`
}

async function hostSettings(ctx: HandlerContext): Promise<SessionExportSettingsSource> {
  try {
    const response = await ctx.client.call<{ settings?: SessionExportSettingsSource }>(
      'settings.get'
    )
    return response.result?.settings ?? null
  } catch {
    return null
  }
}

async function assertSharingAllowed(ctx: HandlerContext): Promise<void> {
  try {
    const response = await ctx.client.call<{ settings?: { artifactSharingEnabled?: boolean } }>(
      'settings.get'
    )
    if (response.result?.settings?.artifactSharingEnabled === false) {
      throw new RuntimeClientError(
        ARTIFACT_SHARING_DISABLED_CODE,
        ARTIFACT_SHARING_DISABLED_MESSAGE,
        { nextSteps: [...ARTIFACT_SHARING_DISABLED_NEXT_STEPS] }
      )
    }
  } catch (error) {
    // Only an explicit "off" denies, as `orca artifacts share` does for older hosts.
    if (error instanceof RuntimeClientError && error.code === ARTIFACT_SHARING_DISABLED_CODE) {
      throw error
    }
  }
}

type ExportResult = {
  id: string
  format: SessionExportFormat
  redacted: boolean
  entries: number
  truncated: boolean
  path: string | null
  shareUrl?: string
  content?: string
}

export function formatExportResult(result: ExportResult): string {
  if (result.path === null && result.content !== undefined) {
    return result.content.replace(/\n$/, '')
  }
  const lines = [
    `Wrote ${result.entries} entries to ${result.path}${result.redacted ? ' (redacted)' : ''}.`
  ]
  if (!result.redacted) {
    lines.push('Not redacted: it may hold secrets and home folder paths.')
  }
  if (result.truncated) {
    lines.push('Older entries or long text were left out.')
  }
  if (result.shareUrl) {
    lines.push(`Shared: ${result.shareUrl}`, SHARE_WARNING)
  }
  return lines.join('\n')
}

export const FORK_SESSION_EXPORT_HANDLERS: Record<string, CommandHandler> = {
  'agent export': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const share = flag(ctx, 'share')
    const formatText = getOptionalStringFlag(ctx.flags, 'format') ?? 'md'
    if (!isSessionExportFormat(formatText)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--format takes one of: ${SESSION_EXPORT_FORMATS.join(', ')}.`
      )
    }
    const format = formatText
    if (flag(ctx, 'redact') && flag(ctx, 'no-redact')) {
      throw new RuntimeClientError('invalid_argument', 'Use --redact or --no-redact, not both.')
    }
    const out = getOptionalStringFlag(ctx.flags, 'out')
    if (share) {
      rejectRemoteSelectionFlags(
        ctx.flags,
        'a share; sharing uses the signed-in desktop. Export the file, then share it from this desktop.'
      )
      if (flag(ctx, 'no-redact')) {
        throw new RuntimeClientError('invalid_argument', 'A share is always redacted.')
      }
      if (format === 'json') {
        throw new RuntimeClientError('invalid_argument', 'Only md and html can be shared.')
      }
      if (out === '-') {
        throw new RuntimeClientError('invalid_argument', '--share needs a file, not --out -.')
      }
      await assertSharingAllowed(ctx)
    }
    const settings = readSessionExportSettings(await hostSettings(ctx))
    const redact = share || flag(ctx, 'redact') || (!flag(ctx, 'no-redact') && settings.redact)
    const read = await ctx.client
      .call<SessionExportDocument>('fork.sessionExport.read', { id })
      .catch(incompatible)
    const doc = redact ? redactSessionExport(read.result) : read.result
    const content = renderSessionExport(doc, format)
    const base = {
      id,
      format,
      redacted: redact,
      entries: doc.entries.length,
      truncated: doc.truncated
    }
    if (out === '-') {
      const printed: ExportResult = { ...base, path: null, content }
      printResult({ ...read, result: printed }, ctx.json, formatExportResult)
      return
    }
    const path = resolve(ctx.cwd, out ?? `${fileStem(id)}.${SESSION_EXPORT_FILE_EXTENSION[format]}`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
    let shareUrl: string | undefined
    if (share) {
      const shared = await ctx.client.call<ArtifactCloudOperation<ArtifactListItem>>(
        'artifacts.share',
        {
          sourceKey: path,
          content,
          contentType: format === 'html' ? 'text/html' : 'text/markdown',
          fileName: basename(path),
          ...(process.env.ORCA_CLOUD_AUTH_TOKEN?.trim()
            ? { authToken: process.env.ORCA_CLOUD_AUTH_TOKEN.trim() }
            : {})
        }
      )
      if (shared.result.status === 'reconnect-required') {
        throw new RuntimeClientError('authentication_required', 'Sign in to Orca and try again.')
      }
      if (shared.result.status !== 'ok') {
        throw new RuntimeClientError('authentication_unconfigured', shared.result.message)
      }
      shareUrl = shared.result.value.shareUrl
    }
    const result: ExportResult = { ...base, path, ...(shareUrl ? { shareUrl } : {}) }
    printResult({ ...read, result }, ctx.json, formatExportResult)
  }
}
