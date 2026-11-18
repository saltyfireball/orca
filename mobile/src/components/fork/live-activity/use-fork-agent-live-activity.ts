// Blackfish (SLRM-2387): Home's agent reads, across every paired server, drive the Live Activity
// and the agents widget. Home stays mounted under other screens, so this runs whenever the app does.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BlackfishLiveActivity } from '../../../../modules/fork-live-activity/src/index'
import type { AgentListInput } from '../../../agents/agent-list-rows'
import {
  EMPTY_LIVE_AGENT_MEMORY,
  foldLiveAgents,
  nextLiveAgentExpiry,
  type LiveAgentMemory
} from './live-activity-model'
import { createLiveAgentPublisher, type LiveAgentPublisher } from './live-activity-publisher'
import {
  loadLiveActivitySettings,
  subscribeLiveActivitySettings,
  type LiveActivitySettings
} from './live-activity-settings'

type NamedHost = Readonly<{ id: string; name: string }>

let sharedPublisher: LiveAgentPublisher | null = null

function publisher(): LiveAgentPublisher | null {
  if (!BlackfishLiveActivity) {
    return null
  }
  sharedPublisher ??= createLiveAgentPublisher(BlackfishLiveActivity)
  return sharedPublisher
}

export function useForkAgentLiveActivity(
  agentList: AgentListInput,
  hosts: readonly NamedHost[]
): void {
  const target = publisher()
  const [settings, setSettings] = useState<LiveActivitySettings | null>(null)
  const memory = useRef<LiveAgentMemory | null>(null)
  // Bumped when a finished row's minutes run out, so it leaves without waiting for a new read.
  const [expiryTick, setExpiryTick] = useState(0)
  const hostNames = useMemo(
    () => Object.fromEntries(hosts.map((host) => [host.id, host.name])),
    [hosts]
  )

  useEffect(() => {
    if (!target) {
      return undefined
    }
    let alive = true
    void Promise.all([loadLiveActivitySettings(), target.load()]).then(([loaded, stored]) => {
      if (alive) {
        memory.current ??= stored
        setSettings(loaded)
      }
    })
    const unsubscribe = subscribeLiveActivitySettings(setSettings)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [target])

  useEffect(() => {
    if (!target || !settings || !memory.current) {
      return undefined
    }
    const now = Date.now()
    const keepMs = settings.keepFinishedMinutes * 60_000
    // Home's clock only ticks while Home is on screen; the Lock Screen needs the real time. With
    // both surfaces off nothing is kept, so the stored titles go too.
    const next =
      settings.liveActivity || settings.widget
        ? foldLiveAgents(memory.current, { ...agentList, now }, hostNames, keepMs)
        : EMPTY_LIVE_AGENT_MEMORY
    memory.current = next
    void target.publish(next, settings, now)
    const expiry = nextLiveAgentExpiry(next)
    if (expiry === null) {
      return undefined
    }
    const timer = setTimeout(
      () => setExpiryTick((tick) => tick + 1),
      Math.max(expiry - now, 0) + 250
    )
    return () => clearTimeout(timer)
  }, [target, settings, agentList, hostNames, expiryTick])
}
