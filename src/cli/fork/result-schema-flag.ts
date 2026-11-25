// Result schema (BAD-816, FORK.md "Result schema"): `--result-schema <json>` (or
// `--result-schema-file <path>`) on task-create and worker-start, and `--result <json>` (or
// `--result-file <path>`) on `send --type worker_done`. The host checks both; the CLI only reads them.
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  FORK_RESULT_SCHEMA_MAX_BYTES,
  FORK_RESULT_VALUE_MAX_BYTES,
  utf8Bytes
} from '../../shared/fork/result-schema'
import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'

export const FORK_RESULT_SCHEMA_FLAGS = ['result-schema', 'result-schema-file']
export const FORK_RESULT_FLAGS = ['result', 'result-file']

function readTextOrFile(
  flags: Map<string, string | boolean>,
  cwd: string,
  flag: string,
  maxBytes: number
): string | undefined {
  const text = getOptionalStringFlag(flags, flag)
  const file = getOptionalStringFlag(flags, `${flag}-file`)
  if (text !== undefined && file !== undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Use either --${flag} or --${flag}-file, not both.`
    )
  }
  let value = text
  if (file !== undefined) {
    try {
      value = readFileSync(isAbsolute(file) ? file : join(cwd, file), 'utf8')
    } catch (error) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--${flag}-file could not be read: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  if (value === undefined) {
    return undefined
  }
  if (utf8Bytes(value) > maxBytes) {
    throw new RuntimeClientError('invalid_argument', `--${flag} takes at most ${maxBytes} bytes.`)
  }
  try {
    JSON.parse(value)
  } catch (error) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${flag} is not JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return value.trim()
}

export function readForkResultSchemaFlags(
  flags: Map<string, string | boolean>,
  cwd: string
): { forkResultSchema?: string } {
  const schema = readTextOrFile(flags, cwd, 'result-schema', FORK_RESULT_SCHEMA_MAX_BYTES)
  return schema === undefined ? {} : { forkResultSchema: schema }
}

export function readForkResultFlag(
  flags: Map<string, string | boolean>,
  cwd: string,
  type: string | undefined
): { forkResult?: string } {
  const result = readTextOrFile(flags, cwd, 'result', FORK_RESULT_VALUE_MAX_BYTES)
  if (result === undefined) {
    return {}
  }
  if (type !== 'worker_done') {
    throw new RuntimeClientError(
      'invalid_argument',
      '--result is only valid with --type worker_done.'
    )
  }
  return { forkResult: result }
}
