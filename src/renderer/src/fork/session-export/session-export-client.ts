// Session export (FORK.md, BAD-688): copy a chat as Markdown from its tab menu. The host that runs
// the chat reads it (fork.sessionExport.read); rendering and redaction run here, with the same
// code `orca agent export` uses. Redaction follows the setting (on by default).
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  readSessionExportSettings,
  type SessionExportDocument,
  type SessionExportSettingsSource
} from '../../../../shared/fork/session-export/session-export'
import { redactSessionExport } from '../../../../shared/fork/session-export/session-export-redact'
import { renderSessionExportMarkdown } from '../../../../shared/fork/session-export/session-export-render'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

const EXPORT_TIMEOUT_MS = 60_000

export async function copyChatAsMarkdown(
  target: RuntimeClientTarget,
  sessionId: string,
  settings: SessionExportSettingsSource
): Promise<void> {
  try {
    const doc = await callRuntimeRpc<SessionExportDocument>(
      target,
      'fork.sessionExport.read',
      { id: sessionId },
      { timeoutMs: EXPORT_TIMEOUT_MS }
    )
    const redact = readSessionExportSettings(settings).redact
    await window.api.ui.writeClipboardText(
      renderSessionExportMarkdown(redact ? redactSessionExport(doc) : doc)
    )
    toast.success(
      redact
        ? translate(
            'fork.sessionExport.copiedRedacted',
            'Copied the chat as Markdown, with secrets and home paths removed.'
          )
        : translate('fork.sessionExport.copied', 'Copied the chat as Markdown.')
    )
  } catch (error) {
    toast.error(
      translate('fork.sessionExport.failed', 'Could not export the chat: {{message}}', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}
