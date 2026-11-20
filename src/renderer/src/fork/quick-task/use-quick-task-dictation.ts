// Quick task (SLRM-2428, FORK.md): the box's mic. The same capture and speech host as dictation
// everywhere else (Settings > Voice picks the model and microphone), without the main window's
// pill and insertion targets: each final transcript is handed to the box's text.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from '@/components/dictation/use-audio-capture'
import { createNonSecureContextUuid } from '../../../../shared/identifiers/non-secure-context-uuid'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'

export type QuickTaskDictationPhase = 'off' | 'idle' | 'starting' | 'listening' | 'finishing'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useQuickTaskDictation(
  voice: GlobalSettings['voice'] | undefined,
  onText: (text: string) => void
) {
  const available = voice?.enabled === true && Boolean(voice.sttModel)
  const [phase, setPhase] = useState<QuickTaskDictationPhase>(available ? 'idle' : 'off')
  const [error, setError] = useState<string | null>(null)
  const capture = useAudioCapture()
  const sessionRef = useRef<string | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })

  useEffect(() => {
    setPhase((current) => (available ? (current === 'off' ? 'idle' : current) : 'off'))
  }, [available])

  useEffect(() => {
    const offFinal = window.api.speech.onFinalTranscript((event) => {
      if (event.sessionId === sessionRef.current && event.text.trim()) {
        onTextRef.current(event.text.trim())
      }
    })
    const offError = window.api.speech.onError((event) => {
      if (event.sessionId === sessionRef.current) {
        setError(event.error)
      }
    })
    return () => {
      offFinal()
      offError()
    }
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    const sessionId = sessionRef.current
    if (!sessionId) {
      return
    }
    setPhase('finishing')
    await capture.finish()
    // Finals are sent before the stop resolves.
    await window.api.speech
      .stopDictation(sessionId)
      .catch((err: unknown) => setError(errorText(err)))
    if (sessionRef.current === sessionId) {
      sessionRef.current = null
    }
    setPhase('idle')
  }, [capture])

  const start = useCallback(async (): Promise<void> => {
    if (!available || !voice || sessionRef.current) {
      return
    }
    const sessionId = `quick-task-${createNonSecureContextUuid()}`
    sessionRef.current = sessionId
    setError(null)
    setPhase('starting')
    let engineStarted = false
    try {
      // Capture first and buffer, so words said while the model loads are kept.
      await capture.start({
        bufferAudio: true,
        sessionId,
        microphoneDeviceId: voice.microphoneDeviceId ?? null,
        microphoneDeviceLabel: voice.microphoneDeviceLabel ?? null,
        onCaptureLost: () => void stop()
      })
      await window.api.speech.startDictation(voice.sttModel, undefined, sessionId)
      engineStarted = true
      await capture.flushBufferedAudio()
      setPhase('listening')
    } catch (err) {
      capture.stop()
      if (engineStarted) {
        await window.api.speech.cancelDictation(sessionId).catch(() => undefined)
      }
      sessionRef.current = null
      setError(errorText(err))
      setPhase('idle')
    }
  }, [available, capture, stop, voice])

  /** Esc and close: drop what was not transcribed yet. */
  const cancel = useCallback((): void => {
    const sessionId = sessionRef.current
    sessionRef.current = null
    capture.stop()
    if (sessionId) {
      void window.api.speech.cancelDictation(sessionId).catch(() => undefined)
    }
    setPhase(available ? 'idle' : 'off')
  }, [available, capture])

  // Closing the box mid-dictation stops the microphone and the session.
  const cancelRef = useRef(cancel)
  useEffect(() => {
    cancelRef.current = cancel
  })
  useEffect(() => () => cancelRef.current(), [])

  const toggle = useCallback((): void => {
    if (phase === 'listening' || phase === 'starting') {
      void stop()
    } else if (phase === 'idle') {
      void start()
    }
  }, [phase, start, stop])

  return { phase, error, toggle, stop, cancel }
}
