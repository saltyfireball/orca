import { useCallback, useState } from 'react'
import type { useStructuredAgentSession } from '../session/structured/use-structured-agent-session'

type Respond = ReturnType<typeof useStructuredAgentSession>['respond']
type PromptItem = Parameters<Respond>[0]

const promptKey = (item: PromptItem): string => `${item.itemId}:${item.revision}`

/** Hold from response press until refusal; acceptance keeps the hold until the host retires the prompt to prevent duplicate responses. */
export function useStructuredPromptResponseHold(
  respond: Respond,
  /** SLRM-2397: fork hook, the chat's folder, carried to its approval card's risk grade (FORK.md "Approval triage"). */
  forkLink?: { worktreePath: string } | null
): {
  respond: Respond
  holds: (item: PromptItem) => boolean
  forkCwd: string | null
} {
  const [heldKey, setHeldKey] = useState<string | null>(null)
  const holdingRespond = useCallback<Respond>(
    async (item, response) => {
      const key = promptKey(item)
      setHeldKey(key)
      const release = (): void => setHeldKey((held) => (held === key ? null : held))
      try {
        const result = await respond(item, response)
        if (result === null) {
          release()
        }
        return result
      } catch (error) {
        release()
        throw error
      }
    },
    [respond]
  )
  return {
    respond: holdingRespond,
    holds: (item) => heldKey === promptKey(item),
    forkCwd: forkLink?.worktreePath ?? null
  }
}
