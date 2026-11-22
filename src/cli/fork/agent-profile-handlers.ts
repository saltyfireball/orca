// FORK.md "Agent profiles": `orca profiles list|show|set|remove|import|confirm`. Reads come from
// the host's fork.agentProfiles.list; writes go through the host's settings (fork.settings.update),
// so the profiles are ordinary settings and a settings file edit works too.
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type {
  ForkSettingsGetResult,
  ForkSettingsUpdateResult
} from '../../shared/fork/settings-wire'
import { normalizeForkAgentProfiles } from '../../shared/fork/agent-profiles/agent-profiles-normalize'
import {
  FORK_AGENT_PROFILE_PERMISSION_MODES,
  isForkAgentProfileName,
  type ForkAgentProfile
} from '../../shared/fork/agent-profiles/agent-profiles-types'
import { forkAgentProfileHash } from '../../shared/fork/agent-profiles/agent-profiles-resolve'
import {
  FORK_AGENT_DEFINITION_DIRS,
  importForkAgentDefinition
} from '../../shared/fork/agent-profiles/agent-profiles-import'
import type {
  ForkAgentProfileRow,
  ForkAgentProfilesListResult
} from '../../shared/fork/agent-profiles/agent-profiles-wire'

/** Output for a result the CLI built itself, in the shape `--json` prints for host results. */
function printLocal<T>(ctx: HandlerContext, result: T, format: (value: T) => string): void {
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, result }, null, 2))
  } else {
    console.log(format(result))
  }
}

async function listRows(ctx: HandlerContext) {
  const response = await ctx.client
    .call<ForkAgentProfilesListResult>('fork.agentProfiles.list')
    .catch((error: unknown) => {
      if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'This Orca host has no agent profiles. Update Orca on the execution host and try again.'
        )
      }
      throw error
    })
  return response
}

async function saved(ctx: HandlerContext): Promise<ForkAgentProfile[]> {
  const response = await ctx.client.call<ForkSettingsGetResult>('fork.settings.get', {})
  return normalizeForkAgentProfiles(response.result.values.forkAgentProfiles)
}

async function save(ctx: HandlerContext, profiles: ForkAgentProfile[]): Promise<void> {
  const response = await ctx.client.call<ForkSettingsUpdateResult>('fork.settings.update', {
    set: { forkAgentProfiles: profiles }
  })
  const rejected = response.result.rejected[0]
  if (rejected) {
    throw new RuntimeClientError('invalid_argument', JSON.stringify(rejected))
  }
}

function nameArg(ctx: HandlerContext): string {
  const name = getRequiredStringFlag(ctx.flags, 'name')
  if (!isForkAgentProfileName(name)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'A profile name is letters, digits, dot, dash or underscore.'
    )
  }
  return name
}

function fields(row: ForkAgentProfileRow): string {
  return [
    `agent ${row.agent}`,
    row.model ? `model ${row.model}` : null,
    row.effort ? `effort ${row.effort}` : null,
    row.permissionMode ? `permission ${row.permissionMode}` : null,
    row.mcpProfile ? `mcp ${row.mcpProfile}` : null,
    row.account ? `account ${row.account}` : null
  ]
    .filter(Boolean)
    .join(', ')
}

export function formatForkAgentProfiles(result: ForkAgentProfilesListResult): string {
  if (result.profiles.length === 0) {
    return 'No agent profiles. Make one with `orca profiles set <name> --agent <agent> ...` or `orca profiles import`.'
  }
  return result.profiles
    .map((row) =>
      [
        `${row.name}: ${fields(row)}${row.needsConfirm ? ' [imported: confirm before use]' : ''}`,
        ...(row.whenToUse ? [`  when to use: ${row.whenToUse}`] : [])
      ].join('\n')
    )
    .join('\n')
}

export function formatForkAgentProfile(row: ForkAgentProfileRow): string {
  return [
    `name: ${row.name}`,
    ...fields(row)
      .split(', ')
      .map((part) => part.replace(' ', ': ')),
    `max permission: ${row.maxPermission}`,
    ...(row.whenToUse ? [`when to use: ${row.whenToUse}`] : []),
    ...(row.imported
      ? [
          `imported from: ${row.imported.path}`,
          `confirmed: ${row.needsConfirm ? `no (run \`orca profiles confirm ${row.name}\`)` : 'yes'}`
        ]
      : []),
    ...(row.preamble ? ['preamble:', row.preamble] : [])
  ].join('\n')
}

async function findRow(ctx: HandlerContext, name: string): Promise<ForkAgentProfileRow> {
  const row = (await listRows(ctx)).result.profiles.find((entry) => entry.name === name)
  if (!row) {
    throw new RuntimeClientError(
      'not_found',
      `No agent profile "${name}". See \`orca profiles list\`.`
    )
  }
  return row
}

/** Applies each given flag over the current profile; an empty value clears an optional field. */
async function setProfile(ctx: HandlerContext): Promise<void> {
  const name = nameArg(ctx)
  const profiles = await saved(ctx)
  const current = profiles.find((entry) => entry.name === name)
  const next: Record<string, unknown> = { ...(current ?? { name }) }
  const flagToField: Record<string, string> = {
    agent: 'agent',
    model: 'model',
    effort: 'effort',
    'permission-mode': 'permissionMode',
    'mcp-profile': 'mcpProfile',
    account: 'account',
    'when-to-use': 'whenToUse'
  }
  for (const [flag, field] of Object.entries(flagToField)) {
    if (ctx.flags.has(flag)) {
      const value = getOptionalStringFlag(ctx.flags, flag)?.trim()
      if (value) {
        next[field] = value
      } else {
        delete next[field]
      }
    }
  }
  const mode = next.permissionMode
  if (mode !== undefined && !FORK_AGENT_PROFILE_PERMISSION_MODES.some((entry) => entry === mode)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--permission-mode takes one of ${FORK_AGENT_PROFILE_PERMISSION_MODES.join(', ')}.`
    )
  }
  const preamble = await readTextOrFileFlag(ctx.flags, ctx.cwd, 'preamble', false)
  if (preamble !== undefined) {
    if (preamble.trim()) {
      next.preamble = preamble.trim()
    } else {
      delete next.preamble
    }
    // Text the user typed is theirs; only the imported copy needs a confirm.
    delete next.imported
  }
  if (!next.agent) {
    throw new RuntimeClientError('invalid_argument', 'A new profile needs --agent.')
  }
  await save(ctx, [...profiles.filter((entry) => entry.name !== name), next as ForkAgentProfile])
  printLocal(ctx, await findRow(ctx, name), formatForkAgentProfile)
}

async function expandPath(path: string, cwd: string): Promise<{ file: string; agent?: string }[]> {
  const full = isAbsolute(path) ? path : resolve(cwd, path)
  const info = await stat(full).catch(() => null)
  if (!info) {
    throw new RuntimeClientError('not_found', `${path} does not exist.`)
  }
  if (info.isFile()) {
    return [{ file: full }]
  }
  const names = await readdir(full)
  return names
    .filter((entry) => /\.(md|toml)$/i.test(entry))
    .sort()
    .map((entry) => ({ file: join(full, entry) }))
}

function harnessOf(file: string): string | undefined {
  const normal = file.replace(/\\/g, '/')
  return FORK_AGENT_DEFINITION_DIRS.find((entry) => normal.includes(`/${entry.dir}/`))?.agent
}

async function importProfiles(ctx: HandlerContext): Promise<void> {
  const given = ctx.flags.get('path')
  const paths = typeof given === 'string' ? [given] : []
  const targets: { file: string }[] = []
  if (paths.length > 0) {
    for (const path of paths) {
      targets.push(...(await expandPath(path, ctx.cwd)))
    }
  } else {
    for (const root of new Set([ctx.cwd, homedir()])) {
      for (const { dir } of FORK_AGENT_DEFINITION_DIRS) {
        const folder = join(root, dir)
        if (await stat(folder).catch(() => null)) {
          targets.push(...(await expandPath(folder, ctx.cwd)))
        }
      }
    }
  }
  const agentFlag = getOptionalStringFlag(ctx.flags, 'agent')
  const nameFlag = getOptionalStringFlag(ctx.flags, 'name')
  if (nameFlag && targets.length !== 1) {
    throw new RuntimeClientError('invalid_argument', '--name needs exactly one definition file.')
  }
  const profiles = await saved(ctx)
  const taken = new Set(profiles.map((entry) => entry.name))
  const imported: string[] = []
  const skipped: string[] = []
  for (const target of targets) {
    const source = await readFile(target.file, 'utf8')
    const agent =
      agentFlag ?? harnessOf(target.file) ?? (target.file.endsWith('.toml') ? 'codex' : 'claude')
    const result = importForkAgentDefinition({
      file: target.file,
      source,
      agent,
      ...(nameFlag ? { name: nameFlag } : {})
    })
    if (!result.ok) {
      skipped.push(`${target.file}: ${result.message}`)
    } else if (taken.has(result.profile.name)) {
      skipped.push(`${target.file}: a profile named ${result.profile.name} already exists`)
    } else {
      taken.add(result.profile.name)
      profiles.push(result.profile)
      imported.push(result.profile.name)
    }
  }
  if (imported.length > 0) {
    await save(ctx, profiles)
  }
  const report = { imported, skipped }
  printLocal(ctx, report, (value) =>
    [
      imported.length
        ? `Imported ${imported.join(', ')}. Read each with \`orca profiles show <name>\`, then \`orca profiles confirm <name>\`.`
        : 'Nothing imported.',
      ...value.skipped.map((line) => `skipped ${line}`)
    ].join('\n')
  )
}

export const FORK_AGENT_PROFILE_HANDLERS: Record<string, CommandHandler> = {
  'profiles list': async (ctx) => {
    printResult(await listRows(ctx), ctx.json, formatForkAgentProfiles)
  },
  'profiles show': async (ctx) => {
    const row = await findRow(ctx, nameArg(ctx))
    printLocal(ctx, row, formatForkAgentProfile)
  },
  'profiles set': setProfile,
  'profiles remove': async (ctx) => {
    const name = nameArg(ctx)
    const profiles = await saved(ctx)
    if (!profiles.some((entry) => entry.name === name)) {
      throw new RuntimeClientError('not_found', `No agent profile "${name}".`)
    }
    await save(
      ctx,
      profiles.filter((entry) => entry.name !== name)
    )
    printLocal(ctx, { removed: name }, () => `Removed ${name}.`)
  },
  'profiles import': importProfiles,
  'profiles confirm': async (ctx) => {
    const name = nameArg(ctx)
    const profiles = await saved(ctx)
    const profile = profiles.find((entry) => entry.name === name)
    if (!profile) {
      throw new RuntimeClientError('not_found', `No agent profile "${name}".`)
    }
    if (!profile.imported || !profile.preamble) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Profile ${name} has no imported preamble to confirm.`
      )
    }
    const confirmed = {
      ...profile,
      imported: {
        ...profile.imported,
        confirmedHash: forkAgentProfileHash(profile.preamble)
      }
    }
    await save(
      ctx,
      profiles.map((entry) => (entry.name === name ? confirmed : entry))
    )
    printLocal(ctx, { confirmed: name }, () => `Confirmed ${name}.`)
  }
}
