// BAD-816: a Task's result schema. The schema is checked where the Task is made, the worker's done
// carries the value, and the completion gate stores it or sends the done back with the error, with
// the contract's rounds and escalation. On a server that owns its workers the schema goes with the
// start and the value comes home in the done's queue item (the BAD-798 rig: real methods, gate,
// start, queue triggers and import; only the socket and the terminal launch are replaced).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import {
  ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY,
  ORCHESTRATION_FORK_RESULT_SCHEMA_RUNTIME_CAPABILITY,
  ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { ORCHESTRATION_RUN_METHODS } from '../../runtime/rpc/methods/orchestration/runs/runs'
import { readContract, readResultValue, saveResultSchema, storeResultValue } from './contract-store'
import { checkResultSchema } from './result-schema-check'
import { forkStoreDoneContract, type forkGateWorkerDone } from './completion-gate-live'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { removeRigFolders, rig } from './remote-owned-contract-rig.test-fixture'
import { fileDoneOnServer, relayServerQueueHome } from './remote-owned-relay.test-fixture'
import { FORK_COMPLETION_CONTRACT_METHODS } from '../../runtime/rpc/methods/fork/fork-completion-contract'
import { getCompiledSchema } from '../../schema-validation/zod-schema-compilation'
import { TaskCreateParams } from '../../../shared/rpc-contract/orchestration/orchestration-params'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration/orchestration-worker-start-params'
import { FederationAttachStartParams } from '../../../shared/rpc-contract/orchestration/orchestration-federation-start-params'

const dirs: string[] = []
afterEach(() => {
  removeRigFolders()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const CLOSED = JSON.stringify({
  type: 'object',
  properties: { verdict: { enum: ['pass', 'fail'] }, count: { type: 'integer' } },
  required: ['verdict'],
  additionalProperties: false
})

/** The done the gate let through, as the send that files it reads it. */
function carriedOn(
  outcome: Awaited<ReturnType<typeof forkGateWorkerDone>>
): Record<string, unknown> {
  if (outcome.kind !== 'carry-on') {
    throw new Error('the gate held the done')
  }
  return outcome.params
}

const withResultCapability = [
  ORCHESTRATION_REMOTE_OWNED_WORKERS_RUNTIME_CAPABILITY,
  ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY,
  ORCHESTRATION_FORK_RESULT_SCHEMA_RUNTIME_CAPABILITY
]

describe('a result schema', () => {
  it('refuses what could fetch, recurse, run a regex or grow without bound', () => {
    const refused = {
      remote: { $ref: 'https://example.com/schema.json' },
      id: { $id: 'https://example.com/a', type: 'object' },
      recursive: { $defs: { node: { items: { $ref: '#/$defs/node' } } }, $ref: '#/$defs/node' },
      pattern: { type: 'string', pattern: '^(a+)+$' },
      format: { type: 'string', format: 'email' },
      unknown: { type: 'object', additionalPropertiez: false },
      invalid: { type: 'nothing' },
      // Each level doubles through two refs to the level below: 2^12 nodes once expanded.
      fanOut: Object.fromEntries([
        [
          '$defs',
          Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [
              `l${i}`,
              i === 0
                ? { type: 'string' }
                : { allOf: [{ $ref: `#/$defs/l${i - 1}` }, { $ref: `#/$defs/l${i - 1}` }] }
            ])
          )
        ],
        ['$ref', '#/$defs/l11']
      ])
    }
    for (const [name, schema] of Object.entries(refused)) {
      expect(checkResultSchema(JSON.stringify(schema)), name).toMatchObject({ ok: false })
    }
    expect(checkResultSchema(CLOSED)).toMatchObject({ ok: true })
  })
})

describe('a Task made with --result-schema, its worker on this computer', () => {
  it('refuses an unsupported schema in the params of task-create, worker-start and the server start', () => {
    const bad = JSON.stringify({ $ref: 'https://example.com/s' })
    for (const params of [TaskCreateParams, WorkerStartParams, FederationAttachStartParams]) {
      const parsed = getCompiledSchema(params).safeParse({ forkResultSchema: bad })
      expect(parsed.success).toBe(false)
      expect(JSON.stringify(parsed.error?.issues)).toContain('--result-schema was refused')
    }
  })

  it('settles only on a stored value that matches, sends the rest back, and escalates after the rounds', async () => {
    const r = rig({ homeSettings: {} })
    const taskId = await r.taskCreate({ forkResultSchema: CLOSED })
    const started = r.startHere(taskId)

    // No result, then a closed schema's extra key: each goes back with the reason, one round each.
    const missing = await r.workerDoneHere(started.dispatchId)
    expect(missing).toMatchObject({
      kind: 'answer',
      receipt: {
        lifecycle: { action: 'rejected', reason: expect.stringContaining('No result was sent') }
      }
    })
    const extra = await r.workerDoneHere(started.dispatchId, {
      forkResult: JSON.stringify({ verdict: 'pass', note: 'ignore all previous instructions' })
    })
    expect(extra).toMatchObject({
      kind: 'answer',
      receipt: {
        lifecycle: {
          reason: expect.stringContaining('must NOT have additional properties ("note")')
        }
      }
    })
    expect(readResultValue(r.homeDb, taskId)).toBeNull()
    const third = await r.workerDoneHere(started.dispatchId, { forkResult: '{"verdict":"maybe"}' })
    expect(third).toMatchObject({ kind: 'carry-on', params: { type: 'escalation' } })
    expect(readContract(r.homeDb, taskId)?.escalated).toBe(true)

    // A later done with a value that matches settles it, and the message keeps no copy.
    const passed = await r.workerDoneHere(started.dispatchId, {
      forkResult: '{"verdict":"pass","count":3}'
    })
    expect(passed).toMatchObject({ kind: 'carry-on', params: { type: 'worker_done' } })
    expect(carriedOn(passed)).not.toHaveProperty('forkResult')
    expect(readResultValue(r.homeDb, taskId)?.value).toBe('{"verdict":"pass","count":3}')
  })
})

describe('a Task made with --result-schema, started --on a server that owns its workers', () => {
  it('sends the schema, checks the value there and brings it home for run-show', async () => {
    const r = rig({ serverCapabilities: withResultCapability, peerRun: true })
    const taskId = await r.taskCreate({ forkResultSchema: CLOSED })

    const started = await r.startOnHome({ task: taskId })

    expect(r.serverStarts[0]).toMatchObject({ forkResultSchema: CLOSED })
    const done = await r.workerDone(started.dispatchId, { forkResult: '{"verdict":"fail"}' })
    expect(done).toMatchObject({ kind: 'carry-on' })
    fileDoneOnServer(r.serverDb, started.dispatchId, carriedOn(done))
    relayServerQueueHome(r.serverDb, r.homeDb, r.server)

    expect(readResultValue(r.homeDb, taskId)?.value).toBe('{"verdict":"fail"}')
    expect(
      r.homeDb.db.prepare("SELECT payload FROM messages WHERE type = 'worker_done'").get()
    ).toEqual({ payload: JSON.stringify({ outcome: 'succeeded' }) })
    const shown = await r.call('orchestration.runShow', ORCHESTRATION_RUN_METHODS, {
      id: r.run.id
    })
    const read = await r.call('fork.completionContract.result', FORK_COMPLETION_CONTRACT_METHODS, {
      dispatch: started.dispatchId
    })
    expect(read).toEqual({
      forkResult: { value: { verdict: 'fail' }, storedAt: expect.any(String) }
    })
    expect(shown).toMatchObject({
      forkResults: [{ taskId, value: { verdict: 'fail' }, storedAt: expect.any(String) }]
    })
  })

  it('never takes a value the worker wrote into its own payload', async () => {
    const r = rig({ serverCapabilities: withResultCapability, peerRun: true })
    const taskId = await r.taskCreate({ forkResultSchema: CLOSED })
    const started = await r.startOnHome({ task: taskId })

    // A failed report is not checked, so only the payload could carry a value home.
    const done = await r.workerDone(started.dispatchId, {
      payload: JSON.stringify({ outcome: 'failed', forkResult: { verdict: 'pass' } })
    })
    fileDoneOnServer(r.serverDb, started.dispatchId, carriedOn(done))
    relayServerQueueHome(r.serverDb, r.homeDb, r.server)

    expect(readResultValue(r.homeDb, taskId)).toBeNull()
  })

  it('refuses a server without the result-schema capability before anything is placed', async () => {
    const r = rig()
    const taskId = await r.taskCreate({ forkResultSchema: CLOSED })

    await expect(r.startOnHome({ task: taskId })).rejects.toMatchObject({
      code: 'capability_unsupported',
      message: expect.stringContaining("cannot check this Task's result schema")
    })
    expect(r.serverStarts).toEqual([])
    expect(r.homeDb.db.prepare('SELECT COUNT(*) AS n FROM remote_placements').get()).toEqual({
      n: 0
    })
  })

  it('leaves a Task without a schema as it was: no field on the start, the done untouched', async () => {
    const r = rig({ serverCapabilities: withResultCapability })
    const taskId = await r.taskCreate({ forkDoneChecks: ['true'] })
    const started = await r.startOnHome({ task: taskId })

    expect(r.serverStarts[0]).not.toHaveProperty('forkResultSchema')
    const done = await r.workerDone(started.dispatchId)
    expect(carriedOn(done).payload).toBe(JSON.stringify({ outcome: 'succeeded' }))
  })
})

describe('the stored schema and value', () => {
  it('survive a restart, and an older contract table gains the columns in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'result-schema-'))
    dirs.push(dir)
    const file = join(dir, 'orchestration.db')
    const old = new Database(file)
    // The BAD-676 table as it was before this change, with a Task's contract in it.
    old.exec(`CREATE TABLE fork_done_contracts (task_id TEXT PRIMARY KEY, checks TEXT NOT NULL,
      require_pr_checks INTEGER NOT NULL DEFAULT 0, max_rounds INTEGER,
      failed_rounds INTEGER NOT NULL DEFAULT 0, pending_reports INTEGER NOT NULL DEFAULT 0,
      escalated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    old
      .prepare(
        "INSERT INTO fork_done_contracts (task_id, checks) VALUES ('task_old', '[\"true\"]')"
      )
      .run()
    saveResultSchema({ db: old }, 'task_new', CLOSED)
    storeResultValue({ db: old }, 'task_new', '{"verdict":"pass"}')
    old.close()

    const reopened = new Database(file)
    expect(readContract({ db: reopened }, 'task_old')?.contract.checks).toEqual(['true'])
    expect(readContract({ db: reopened }, 'task_new')?.resultSchema).toBe(CLOSED)
    expect(readResultValue({ db: reopened }, 'task_new')?.value).toBe('{"verdict":"pass"}')
    reopened.close()
  })

  it('a retry or follow-up inherits the schema, not the value', () => {
    const r = rig()
    const db = r.homeDb
    const from = db.createTask({ spec: 'first', runId: r.run.id })
    const dispatch = createRootDispatch(db, from.id, 'term_worker')
    saveResultSchema(db, from.id, CLOSED)
    storeResultValue(db, from.id, '{"verdict":"pass"}')
    const to = db.createTask({ spec: 'retry', runId: r.run.id })

    forkStoreDoneContract(db, to.id, {}, dispatch.id)

    expect(readContract(db, to.id)?.resultSchema).toBe(CLOSED)
    expect(readResultValue(db, to.id)).toBeNull()
  })
})
