// Result schema (BAD-816, FORK.md "Result schema"): the hooks upstream files call.
// - `forkStoreResultSchema(db, taskId, params)`: from forkStoreDoneContract, beside the checks.
// - `forkResultSchemaTaskSpec(taskId, cli, spec)`: the worker preamble's part for the schema.
// - `forkTakeRemoteResult(db, mail)`: the Run home's import of a server's done, which stores the
//   value the server checked and takes it out of the message.
// - `forkResultOfDispatch(db, dispatchId)` and `forkRunResults(db, runId)`: worker-read and run-show.
// An invalid schema fails the params themselves (registerForkResultSchemaCheck).
// The gate itself is part of the completion contract (completion-gate.ts).
import { z } from 'zod'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  ForkResultSchemaShape,
  isJsonRecord,
  resultSchemaTaskText,
  type ForkResultRead
} from '../../../shared/fork/result-schema'
import {
  clearResultValue,
  listRunResults,
  readContract,
  readResultValue,
  saveResultSchema,
  storeResultValue,
  type ContractDbHandle
} from './contract-store'
import { checkResultSchema, checkResultValue } from './result-schema-check'
import { getRemoteDispatch } from '../../runtime/orchestration/db/remote-owned/remote-dispatch-records'

function resultSchemaOf(raw: unknown): string | undefined {
  if (!isJsonRecord(raw)) {
    return undefined
  }
  const parsed = z.object(ForkResultSchemaShape).safeParse(raw)
  return parsed.success ? parsed.data.forkResultSchema : undefined
}

/** The database the preamble reads a Task's schema from; one per runtime. */
let preambleDb: ContractDbHandle | null = null

export function forkResultSchemaUseDb(db: ContractDbHandle): void {
  preambleDb = db
}

export function forkStoreResultSchema(db: ContractDbHandle, taskId: string, raw: unknown): void {
  preambleDb = db
  const schema = resultSchemaOf(raw)
  if (schema !== undefined && checkResultSchema(schema).ok) {
    saveResultSchema(db, taskId, schema)
  }
  // A --retry-of start of the same Task (a server's) inherits the schema, not the value.
  if (isJsonRecord(raw) && typeof raw.retryOf === 'string') {
    clearResultValue(db, taskId)
  }
}

/** True when the request itself declares a result schema. */
export function forkDeclaresResultSchema(raw: unknown): boolean {
  return resultSchemaOf(raw) !== undefined
}

/** The task as the worker reads it, with the schema and the flag that submits after it. */
export function forkResultSchemaTaskSpec(taskId: string, cli: string, spec: string): string {
  const schema = preambleDb ? readContract(preambleDb, taskId)?.resultSchema : null
  return schema ? `${spec}\n\n${resultSchemaTaskText(cli, schema)}` : spec
}

/** The fields of a sent message the result rides in. */
type ResultSendShape = { type?: string; payload?: string; forkResult?: string }

/** A JSON object payload; null for none, invalid JSON or any other JSON value. */
function payloadRecord(payload: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload ?? '')
    return isJsonRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The payload without a `forkResult` key: only the gate puts one there, never the worker. */
function payloadWithoutResult(payload: string | undefined): string | undefined {
  const parsed = payload?.includes('"forkResult"') ? payloadRecord(payload) : null
  if (!parsed) {
    return payload
  }
  const { forkResult: _result, ...rest } = parsed
  return JSON.stringify(rest)
}

/** The done without its result, which is kept on the Task, never in the message. */
export function withoutResult<P extends ResultSendShape>(params: P): P {
  const payload =
    params.type === 'worker_done' ? payloadWithoutResult(params.payload) : params.payload
  if (params.forkResult === undefined && payload === params.payload) {
    return params
  }
  const { forkResult: _result, ...rest } = params
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: P without forkResult and with its payload replaced by a string is still a P (both fields are optional).
  return { ...rest, payload } as P
}

/**
 * BAD-816: a worker on a server that owns its workers reports to the Run home through a queue; the
 * stored value rides home in the done's payload, where the import takes it out (forkTakeRemoteResult).
 */
export function withResultForHome(
  db: OrchestrationDb,
  dispatchId: string,
  taskId: string,
  payload: string | undefined
): string | undefined {
  const runId = db.getDispatchContextById(dispatchId)?.run_id
  const stored = readResultValue(db, taskId)
  if (!runId || !stored || !db.getPeerRun(runId)) {
    return payload
  }
  const value: unknown = JSON.parse(stored.value)
  return JSON.stringify({ ...payloadRecord(payload), forkResult: value })
}

/** A --result on a done whose Task declares no schema: refused, nothing stored. */
export function resultNotDeclared(taskId: string): unknown {
  return {
    lifecycle: {
      action: 'rejected',
      code: 'result_not_declared',
      reason: `Task ${taskId} declares no result schema, so it takes no --result. Send worker_done again without it. Nothing was stored.`
    }
  }
}

type ImportedMail = {
  taskId: string | null
  message: { type: string; payload: string | null }
}

/**
 * A server's done for a Task this home declared a schema on: the value the server checked is
 * checked again against the home's schema and stored here, and the message keeps no copy of it.
 */
export function forkTakeRemoteResult<M extends ImportedMail>(db: OrchestrationDb, mail: M): M {
  const { payload } = mail.message
  if (mail.message.type !== 'worker_done' || !payload || !payload.includes('"forkResult"')) {
    return mail
  }
  const parsed = payloadRecord(payload)
  if (!parsed || !('forkResult' in parsed)) {
    return mail
  }
  const { forkResult, ...rest } = parsed
  const schema = mail.taskId ? readContract(db, mail.taskId)?.resultSchema : null
  if (mail.taskId && schema) {
    const checked = checkResultValue(schema, JSON.stringify(forkResult))
    if (checked.ok) {
      storeResultValue(db, mail.taskId, checked.canonical)
    }
  }
  return { ...mail, message: { ...mail.message, payload: JSON.stringify(rest) } }
}

function readOf(text: string, at: string): ForkResultRead {
  const value: unknown = JSON.parse(text)
  return { value, ...(at ? { storedAt: at } : {}) }
}

/** The Task of a Dispatch here, or of a worker a paired server runs for this Run. */
export function forkResultOfDispatch(
  db: OrchestrationDb,
  dispatchId: string
): { forkResult?: ForkResultRead } {
  const taskId =
    db.getDispatchContextById(dispatchId)?.task_id ?? getRemoteDispatch(db, dispatchId)?.task_id
  return forkResultRead(db, taskId)
}

/** `forkResult` for worker-read: present only for a Task that declares a schema. */
export function forkResultRead(
  db: ContractDbHandle,
  taskId: string | null | undefined
): { forkResult?: ForkResultRead } {
  if (!taskId || !readContract(db, taskId)?.resultSchema) {
    return {}
  }
  const stored = readResultValue(db, taskId)
  return { forkResult: stored ? readOf(stored.value, stored.at) : {} }
}

/** `forkResults` for run-show: each Task of the Run with a stored value. */
export function forkRunResults(
  db: ContractDbHandle,
  runId: string
): { forkResults?: (ForkResultRead & { taskId: string })[] } {
  const results = listRunResults(db, runId)
  return results.length > 0
    ? {
        forkResults: results.map((entry) => ({
          taskId: entry.taskId,
          ...readOf(entry.value, entry.at)
        }))
      }
    : {}
}
