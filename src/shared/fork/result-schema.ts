// Result schema (BAD-816, FORK.md "Result schema"): a Task can declare a JSON Schema, and its
// worker's done carries a JSON value that must validate before the Task settles. Pure parts shared
// by the CLI, the host and the tests; the validator itself runs on the host
// (src/main/fork/completion-contract/result-schema-check.ts).
import { z } from 'zod'

/** The schema is the coordinator's text: kept small, so it costs little in the worker's prompt. */
export const FORK_RESULT_SCHEMA_MAX_BYTES = 16 * 1024
/** The value is worker output, stored on the Task and read back by coordinators and scripts. */
export const FORK_RESULT_VALUE_MAX_BYTES = 64 * 1024

/** The host's validator (ajv runs only there); without one the shape checks the size alone. */
let hostSchemaCheck: ((schema: string) => string | null) | null = null

export function registerForkResultSchemaCheck(check: (schema: string) => string | null): void {
  hostSchemaCheck = check
}

/**
 * `--result-schema` on task-create and worker-start, and on the paired-server start wire. An
 * invalid or unsupported schema fails the params, so every path refuses it before any effect.
 */
export const ForkResultSchemaShape = {
  /** Fork (BAD-816): a JSON Schema (draft-07) the worker's result must match before the Task settles. */
  forkResultSchema: z
    .string()
    .min(1)
    .max(FORK_RESULT_SCHEMA_MAX_BYTES)
    .optional()
    .superRefine((schema, ctx) => {
      const error = schema === undefined ? null : hostSchemaCheck?.(schema)
      if (error) {
        ctx.addIssue({ code: 'custom', message: `--result-schema was refused: ${error}` })
      }
    })
}

/** `--result` on `send --type worker_done`: the one way a value reaches the Task. */
export const ForkResultSendShape = {
  /** Fork (BAD-816): the worker's JSON result, checked against the Task's result schema. */
  forkResult: z.string().max(FORK_RESULT_VALUE_MAX_BYTES).optional()
}

/** A JSON object (not an array or null): schemas, values and payloads are read through it. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The worker's preamble part: the schema (coordinator text) and the flag that submits. */
export function resultSchemaTaskText(cli: string, schema: string): string {
  const fence = '`'.repeat(Math.max(3, ...(schema.match(/`+/gu) ?? []).map((r) => r.length + 1)))
  return `=== RESULT ===
This Task needs a JSON result matching this schema. Add --result-file <file.json> (or --result '<json>') to your \`${cli} orchestration send --type worker_done\`; a done without a valid result is sent back with the error.
${fence}json
${schema}
${fence}`
}

/** What `--json` reads return for a Task: the value as data, never as text to follow. */
export type ForkResultRead = {
  /** The parsed JSON value; absent when the Task has no stored value. */
  value?: unknown
  storedAt?: string
}
