// Session export (FORK.md, BAD-688): `orca agent export` and the chat tab menu read a conversation
// as an export document from the host that holds it (--environment reaches a paired host).
import { defineMethod } from '../../core'
import {
  ForkSessionExportReadParams,
  type SessionExportDocument
} from '../../../../../shared/fork/session-export/session-export'
import { readSessionExport } from '../../../../fork/session-export/session-export-read'

export const FORK_SESSION_EXPORT_METHODS = [
  defineMethod({
    name: 'fork.sessionExport.read',
    permission: 'workspace',
    params: ForkSessionExportReadParams,
    handler: async (params, ctx): Promise<SessionExportDocument> =>
      readSessionExport(ctx, params.id)
  })
] as const
