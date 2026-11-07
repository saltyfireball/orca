// SLRM-1394: what the app hands a broker process at spawn, and the one change the broker makes to
// the provider supervisor it runs. Dependency-free: the broker entry loads it under plain Node.

/** Env var carrying the broker spec (base64 JSON); the broker strips it from the provider's env. */
export const CHAT_SURVIVE_SPEC_ENV = 'ORCA_CHAT_SURVIVE_SPEC'

/** Upstream's supervisor spec variable (provider-process-supervisor.ts). */
const PROVIDER_SUPERVISOR_SPEC_ENV = 'ORCA_PROVIDER_SUPERVISOR_SPEC'

export type ChatSurviveBrokerSpec = {
  v: 1
  socketPath: string
  token: string
  /** The app process that spawns the broker; the broker serves it over stdio while it lives. */
  ownerPid: number
  orphanTimeoutMs: number
}

export function encodeChatSurviveBrokerSpec(spec: ChatSurviveBrokerSpec): string {
  return Buffer.from(JSON.stringify(spec)).toString('base64')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseChatSurviveBrokerSpec(raw: string | undefined): ChatSurviveBrokerSpec | null {
  if (!raw) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    typeof value.socketPath !== 'string' ||
    value.socketPath.length === 0 ||
    typeof value.token !== 'string' ||
    value.token.length < 32 ||
    !isPositiveInteger(value.ownerPid) ||
    !isPositiveInteger(value.orphanTimeoutMs)
  ) {
    return null
  }
  return {
    v: 1,
    socketPath: value.socketPath,
    token: value.token,
    ownerPid: value.ownerPid,
    orphanTimeoutMs: value.orphanTimeoutMs
  }
}

/**
 * The supervisor stops its provider as soon as its parent is not `ownerPid`. Under a broker its
 * parent is the broker, so the broker names itself: the provider then dies with the broker, never
 * with the app. Returns null when the env carries no readable supervisor spec.
 */
export function supervisorEnvOwnedBy(
  env: NodeJS.ProcessEnv,
  brokerPid: number
): NodeJS.ProcessEnv | null {
  const raw = env[PROVIDER_SUPERVISOR_SPEC_ENV]
  if (!raw) {
    return null
  }
  let spec: unknown
  try {
    spec = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    return null
  }
  if (!isRecord(spec) || !isPositiveInteger(spec.ownerPid)) {
    return null
  }
  const owned = Buffer.from(JSON.stringify({ ...spec, ownerPid: brokerPid })).toString('base64')
  return { ...env, [PROVIDER_SUPERVISOR_SPEC_ENV]: owned }
}
