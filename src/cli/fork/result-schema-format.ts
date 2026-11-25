// Result schema (BAD-816): the stored result in the text views of worker-read and run-show. The
// value is worker output, so it is shown fenced as data; --json returns it as data unchanged.
import { resultValueText } from '../../shared/fork/completion-contract'
import { isJsonRecord, type ForkResultRead } from '../../shared/fork/result-schema'
import type { RuntimeClient } from '../runtime/client'

/** The Task's stored result for `worker-read`; nothing from a host that has no result schema. */
export async function readForkWorkerResult(
  client: RuntimeClient,
  dispatch: string
): Promise<{ forkResult?: ForkResultRead }> {
  try {
    return (
      await client.call<{ forkResult?: ForkResultRead }>('fork.completionContract.result', {
        dispatch
      })
    ).result
  } catch {
    return {}
  }
}

function fieldOf(value: unknown, key: string): unknown {
  return isJsonRecord(value) ? value[key] : undefined
}

/** The worker-read block for a Task with a result schema; empty for one without. */
export function forkWorkerResultText(value: unknown): string {
  const read = fieldOf(value, 'forkResult')
  if (typeof read !== 'object' || read === null) {
    return ''
  }
  const stored = fieldOf(read, 'value')
  return stored === undefined
    ? 'Result: none stored yet (the Task declares a result schema).'
    : resultValueText(JSON.stringify(stored, null, 2))
}

/** One line for run-show: how many of the Run's Tasks have a stored result. */
export function forkRunResultsLine(value: unknown): string {
  const results = fieldOf(value, 'forkResults')
  return Array.isArray(results) && results.length > 0
    ? `\n${results.length} Task(s) have a stored result; read them as data with --json (forkResults).`
    : ''
}
