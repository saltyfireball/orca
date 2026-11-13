// Settings from the CLI (FORK.md): `orca settings`, through the app's fork.settings.* RPC.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  forkSettingEntry,
  suggestForkSettingKey
} from '../../shared/fork/settings-catalog/settings-catalog'
import {
  parseForkSettingsFile,
  renderForkSettingsFile
} from '../../shared/fork/settings-catalog/settings-jsonc'
import type {
  ForkSettingsGetResult,
  ForkSettingsUpdateResult
} from '../../shared/fork/settings-wire'
import {
  buildSettingRow,
  buildSettingRows,
  formatSetting,
  formatSettingsList,
  formatSettingsRejection,
  formatSettingsUpdate
} from './settings-format'

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

/** An app without the fork method answers method_not_found; say what that means. */
async function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  try {
    return await ctx.client.call<T>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'The running app does not have `orca settings` yet. Update and restart it.'
      )
    }
    throw error
  }
}

function requireEntry(key: string) {
  const entry = forkSettingEntry(key)
  if (!entry) {
    const near = suggestForkSettingKey(key)
    throw invalid(
      `Unknown setting "${key}".${near ? ` Did you mean "${near}"?` : ''} List them with: orca settings list`
    )
  }
  return entry
}

function requireKey(ctx: HandlerContext): string {
  const key = getOptionalStringFlag(ctx.flags, 'key')
  if (!key) {
    throw invalid('Name a setting key. List them with: orca settings list')
  }
  return key
}

/** JSON when it parses, plain text otherwise: `15`, `true` and `dark` all mean what they say. */
export function parseSettingValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function update(
  ctx: HandlerContext,
  params: { set?: Record<string, unknown>; reset?: string[]; dryRun?: boolean }
): Promise<void> {
  const reply = await call<ForkSettingsUpdateResult>(ctx, 'fork.settings.update', params)
  if (reply.result.rejected.length > 0) {
    throw invalid(formatSettingsRejection(reply.result))
  }
  printResult(reply, ctx.json, formatSettingsUpdate)
}

export const FORK_SETTINGS_HANDLERS: Record<string, CommandHandler> = {
  'settings list': async (ctx) => {
    const reply = await call<ForkSettingsGetResult>(ctx, 'fork.settings.get', {})
    const settings = buildSettingRows(reply.result, {
      changed: ctx.flags.has('changed'),
      filter: getOptionalStringFlag(ctx.flags, 'filter')
    })
    printResult({ ...reply, result: { settings } }, ctx.json, (result) =>
      formatSettingsList(result.settings)
    )
  },
  'settings get': async (ctx) => {
    const entry = requireEntry(requireKey(ctx))
    const reply = await call<ForkSettingsGetResult>(ctx, 'fork.settings.get', {})
    printResult({ ...reply, result: buildSettingRow(entry, reply.result) }, ctx.json, formatSetting)
  },
  'settings set': async (ctx) => {
    const key = requireKey(ctx)
    const raw = ctx.flags.get('value')
    if (typeof raw !== 'string') {
      throw invalid(`Give "${key}" a value: orca settings set ${key} <value>`)
    }
    await update(ctx, { set: { [key]: parseSettingValue(raw) } })
  },
  'settings reset': async (ctx) => {
    const reset = getRepeatedStringFlag(ctx.flags, 'key')
    if (reset.length === 0) {
      throw invalid('Name at least one setting key to reset.')
    }
    await update(ctx, { reset })
  },
  'settings export': async (ctx) => {
    const reply = await call<ForkSettingsGetResult>(ctx, 'fork.settings.get', {})
    const changedOnly = ctx.flags.has('changed-only')
    const text = renderForkSettingsFile(reply.result, { changedOnly })
    const file = getOptionalStringFlag(ctx.flags, 'file')
    if (!file) {
      const settings = Object.fromEntries(
        buildSettingRows(reply.result, { changed: changedOnly })
          .filter((row) => !row.secret && !row.readOnly && row.value !== undefined)
          .map((row) => [row.key, row.value])
      )
      printResult({ ...reply, result: { settings } }, ctx.json, () => text.trimEnd())
      return
    }
    const path = resolve(ctx.cwd, file)
    writeFileSync(path, text)
    printResult({ ...reply, result: { file: path } }, ctx.json, (result) =>
      [
        `Wrote the settings to ${result.file}`,
        `Apply your edits with: orca settings apply --file ${file}`
      ].join('\n')
    )
  },
  'settings apply': async (ctx) => {
    const file = getOptionalStringFlag(ctx.flags, 'file')
    if (!file) {
      throw invalid('Name the settings file: orca settings apply --file <path>')
    }
    let set: Record<string, unknown>
    try {
      set = parseForkSettingsFile(readFileSync(resolve(ctx.cwd, file), 'utf8'))
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : String(error))
    }
    await update(ctx, { set, dryRun: ctx.flags.has('dry-run') })
  }
}
