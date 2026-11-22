// BAD-691 (FORK.md "Worktree reclaim"): the Space page's way to free disk inside idle workspaces.
// It lists what would go (a dry run), then removes it on a click. The workspaces stay.
import React, { useCallback, useState } from 'react'
import { Eraser, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { formatBytes } from '../../../../shared/text/format-bytes'
import type { ForkWorktreeReclaimResult } from '../../../../shared/fork/worktree-reclaim'

const METHOD = 'fork.worktreeReclaim.run'
const TIMEOUT_MS = 30 * 60_000

export function ForkWorktreeReclaimButton({
  onReclaimed
}: {
  onReclaimed?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<ForkWorktreeReclaimResult | null>(null)

  const look = useCallback(async () => {
    setOpen(true)
    setBusy(true)
    setPlan(null)
    try {
      setPlan(
        await callRuntimeRpc<ForkWorktreeReclaimResult>(
          { kind: 'local' },
          METHOD,
          {},
          { timeoutMs: TIMEOUT_MS }
        )
      )
    } catch (error) {
      setOpen(false)
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const reclaim = useCallback(async () => {
    setBusy(true)
    try {
      if (plan && !plan.enabled) {
        await updateSettings({ forkWorktreeReclaim: true })
      }
      const done = await callRuntimeRpc<ForkWorktreeReclaimResult>(
        { kind: 'local' },
        METHOD,
        { apply: true },
        { timeoutMs: TIMEOUT_MS }
      )
      toast.success(
        t('fork.worktreeReclaim.done', 'Freed {{size}} from idle workspaces.', {
          size: formatBytes(done.totalBytes)
        })
      )
      setOpen(false)
      onReclaimed?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [onReclaimed, plan, t, updateSettings])

  const affected = plan?.worktrees.filter((row) => !row.skipReason && row.bytes > 0) ?? []
  const skipped =
    (plan?.worktrees.length ?? 0) - (plan?.worktrees.filter((r) => !r.skipReason).length ?? 0)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void look()}
        disabled={busy}
        className="mr-1.5 shrink-0"
      >
        <Eraser className="size-3.5" />
        {t('fork.worktreeReclaim.button', 'Reclaim')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('fork.worktreeReclaim.title', 'Reclaim disk in idle workspaces')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'fork.worktreeReclaim.description',
                'Removes git-ignored dependencies, build output and caches from workspaces that have been idle. Workspaces, branches, env files and uncommitted work stay. Your setup script reinstalls what is removed.'
              )}
            </DialogDescription>
          </DialogHeader>
          {busy && !plan ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : plan ? (
            <div className="space-y-2 text-sm">
              <div className="font-medium">
                {t('fork.worktreeReclaim.summary', '{{size}} in {{count}} workspaces', {
                  size: formatBytes(plan.totalBytes),
                  count: affected.length
                })}
              </div>
              <ul className="scrollbar-sleek max-h-48 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {affected.map((row) => (
                  <li key={row.worktreeId} className="flex justify-between gap-3">
                    <span className="truncate">{`${row.repoName}  ${row.branch ?? row.path}`}</span>
                    <span className="shrink-0">{formatBytes(row.bytes)}</span>
                  </li>
                ))}
              </ul>
              {skipped > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {t(
                    'fork.worktreeReclaim.skipped',
                    '{{count}} workspaces skipped: in use, recently active or not tracked.',
                    { count: skipped }
                  )}
                </div>
              ) : null}
              {!plan.enabled ? (
                <div className="text-xs text-muted-foreground">
                  {t(
                    'fork.worktreeReclaim.off',
                    'Reclaim is off. Confirming turns it on (setting forkWorktreeReclaim).'
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              {t('fork.worktreeReclaim.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void reclaim()}
              disabled={busy || !plan || affected.length === 0}
            >
              {t('fork.worktreeReclaim.confirm', 'Reclaim')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
