// Worker archive (FORK.md, BAD-669): mounted once at the app root. Reads why each finished worker
// workspace is still there about every minute, and tells this machine which workspace the window
// shows so the archive never removes it from under you.
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { readForkWorkerArchiveStatus, reportForkWorkspaceFocus } from './worker-archive-client'
import { setWorkerArchiveStatus } from './worker-archive-store'

const POLL_MS = 60_000
/** One id per window; the host drops it when the reports stop. */
const CLIENT_ID = `window-${Math.random().toString(36).slice(2)}`

export function ForkWorkerArchiveReporter(): null {
  const active = useAppStore((s) => s.activeWorktreeId)
  useEffect(() => {
    const report = (): void => {
      void reportForkWorkspaceFocus(CLIENT_ID, active ?? null).catch(() => undefined)
    }
    report()
    const timer = setInterval(report, POLL_MS)
    return () => clearInterval(timer)
  }, [active])
  useEffect(() => {
    const read = (): void => {
      void readForkWorkerArchiveStatus().then(setWorkerArchiveStatus, () => undefined)
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return null
}
