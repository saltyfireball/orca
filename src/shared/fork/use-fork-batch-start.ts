// Batch start (FORK.md, SLRM-2395): the box's state. A prompt clears only once its machine has
// answered that every model started (created, or queued, with the machine named); anything that
// failed stays in the box with the failed models selected, so sending again starts no duplicates.
import { useCallback, useRef, useState } from 'react'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import {
  foldForkBatchAnswer,
  forkBatchPromptExcerpt,
  type ForkBatchStartConfig,
  type ForkBatchStartResult
} from './batch-start'

export type ForkBatchAck = { id: number; excerpt: string; lines: string[] }

/** Acknowledgements kept on screen, newest first. */
const ACK_LIMIT = 8

export type ForkBatchSubmitOutcome = 'cleared' | 'close' | 'kept'

export function useForkBatchStart(args: {
  config: ForkBatchStartConfig
  initialAgents: TuiAgent[]
  labelOf: (agent: TuiAgent) => string
  send: (prompt: string, agents: TuiAgent[], auto: boolean) => Promise<ForkBatchStartResult>
}) {
  const { config, labelOf, send } = args
  const [prompt, setPrompt] = useState('')
  const [agents, setAgents] = useState<TuiAgent[]>(args.initialAgents)
  const [auto, setAuto] = useState(config.autoHost)
  const [keepOpen, setKeepOpen] = useState(config.keepOpen)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acks, setAcks] = useState<ForkBatchAck[]>([])
  const nextAckId = useRef(1)
  const inFlight = useRef(false)

  const toggleAgent = useCallback((agent: TuiAgent): void => {
    setAgents((current) =>
      current.includes(agent) ? current.filter((id) => id !== agent) : [...current, agent]
    )
  }, [])

  const submit = useCallback(
    async (background: boolean): Promise<ForkBatchSubmitOutcome> => {
      const text = prompt
      if (inFlight.current || !text.trim() || agents.length === 0) {
        return 'kept'
      }
      inFlight.current = true
      setSending(true)
      setError(null)
      try {
        const folded = foldForkBatchAnswer(await send(text, agents, auto), labelOf)
        if (folded.lines.length > 0) {
          const ack = {
            id: nextAckId.current++,
            excerpt: forkBatchPromptExcerpt(text),
            lines: folded.lines
          }
          setAcks((current) => [ack, ...current].slice(0, ACK_LIMIT))
        }
        if (!folded.allStarted) {
          if (folded.retryAgents.length > 0) {
            setAgents(folded.retryAgents)
          }
          setError(folded.error)
          return 'kept'
        }
        setPrompt('')
        return background || keepOpen ? 'cleared' : 'close'
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        return 'kept'
      } finally {
        inFlight.current = false
        setSending(false)
      }
    },
    [agents, auto, keepOpen, labelOf, prompt, send]
  )

  return {
    prompt,
    setPrompt,
    agents,
    toggleAgent,
    auto,
    setAuto,
    keepOpen,
    setKeepOpen,
    sending,
    error,
    acks,
    submit
  }
}
