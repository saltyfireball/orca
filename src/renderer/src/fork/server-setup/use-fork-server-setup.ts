// Set up on a server (FORK.md, SLRM-2312): the new-workspace host picker's "Set up on SERVER..."
// rows. Clicking one clones the project onto that paired server from its git remote (the server's
// own git credentials), registers it through the store's stock clone path, checks readiness, then
// selects the server so the launch goes on there.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  getProjectHostSetupSelectionKey,
  type NeedsSetupProjectHostOption,
  type ProjectHostSetupOption
} from '@/lib/workspace/creation/project-host-setup-options'
import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  checkForkCloneUrl,
  describeForkServerSetupReadiness,
  forkProjectCloneUrl,
  forkServerSetupOffered,
  forkServerSetupParent,
  forkServerSetupReadinessOn,
  type ForkServerSetupReadiness
} from '../../../../shared/fork/server-setup'
import {
  FORK_SERVER_SETUP_PLAN_METHOD,
  FORK_SERVER_SETUP_READINESS_METHOD,
  FORK_SERVER_SETUP_READINESS_TIMEOUT_MS,
  type ForkServerSetupPlan
} from '../../../../shared/fork/server-setup-wire'
import {
  ForkServerSetupError,
  runForkServerSetup,
  type ForkServerSetupStage
} from '../../../../shared/fork/server-setup-flow'

const PLAN_TIMEOUT_MS = 15_000

export type ForkServerSetupProgress = { stage: ForkServerSetupStage; folder: string | null }

export type ForkServerSetupState = {
  /** Rows are offered: the setting is on and the project has a clonable git remote. */
  offered: boolean
  /** The parent folder setting, shown in each row before a plan names the exact folder. */
  parent: string
  progress: ReadonlyMap<string, ForkServerSetupProgress>
  errors: ReadonlyMap<string, string>
  start: (option: NeedsSetupProjectHostOption) => void
}

/** The store already showed this failure (setupProjectClone toasts its own errors). */
class ReportedError extends Error {}

function without<T>(map: ReadonlyMap<string, T>, key: string): Map<string, T> {
  const next = new Map(map)
  next.delete(key)
  return next
}

function readinessToast(serverName: string, readiness: ForkServerSetupReadiness | null): void {
  const title = translate('fork.serverSetup.doneTitle', 'Set up on {{host}}', { host: serverName })
  if (!readiness || readiness.missing.length === 0) {
    toast.success(
      title,
      readiness ? { description: describeForkServerSetupReadiness(readiness) } : {}
    )
    return
  }
  toast.warning(title, {
    description: describeForkServerSetupReadiness(readiness),
    duration: 15_000
  })
}

export function useForkServerSetup(
  hostOptions: readonly ProjectHostSetupOption[],
  onReady: (selectionKey: string) => void
): ForkServerSetupState {
  const settings = useAppStore((state) => state.settings)
  const projects = useAppStore((state) => state.projects)
  const repos = useAppStore((state) => state.repos)
  const projectId = hostOptions[0]?.projectId ?? null
  const project = projects.find((entry) => entry.id === projectId)
  const url = useMemo(() => forkProjectCloneUrl(project, repos), [project, repos])
  const offered =
    forkServerSetupOffered(settings) &&
    project !== undefined &&
    project.kind !== 'folder' &&
    checkForkCloneUrl(url).ok
  const parent = forkServerSetupParent(settings)
  const [progress, setProgress] = useState<ReadonlyMap<string, ForkServerSetupProgress>>(new Map())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const start = useCallback(
    (option: NeedsSetupProjectHostOption): void => {
      const host = parseExecutionHostId(option.hostId)
      if (host?.kind !== 'runtime' || !project || progress.has(option.hostId)) {
        return
      }
      const target = { kind: 'environment' as const, environmentId: host.environmentId }
      const hostId = option.hostId
      const update = (stage: ForkServerSetupStage, plan: ForkServerSetupPlan | null): void => {
        if (live.current) {
          setProgress((current) =>
            new Map(current).set(hostId, { stage, folder: plan?.clonePath ?? null })
          )
        }
      }
      setErrors((current) => without(current, hostId))
      update('planning', null)
      void runForkServerSetup(
        {
          plan: (params) =>
            callRuntimeRpc<ForkServerSetupPlan>(target, FORK_SERVER_SETUP_PLAN_METHOD, params, {
              timeoutMs: PLAN_TIMEOUT_MS
            }),
          clone: async (plan, checkedUrl) => {
            const result = await useAppStore.getState().setupProjectClone({
              projectId: project.id,
              hostId,
              url: checkedUrl,
              destination: plan.destination,
              folderName: plan.folderName,
              displayName: project.displayName
            })
            if (!result) {
              throw new ReportedError('clone failed')
            }
            return result.setup.id
          },
          ...(forkServerSetupReadinessOn(settings)
            ? {
                readiness: (path: string) =>
                  callRuntimeRpc<ForkServerSetupReadiness>(
                    target,
                    FORK_SERVER_SETUP_READINESS_METHOD,
                    { path },
                    { timeoutMs: FORK_SERVER_SETUP_READINESS_TIMEOUT_MS }
                  )
              }
            : {}),
          onStage: update
        },
        { url, parent, serverName: option.label }
      )
        .then((outcome) => {
          readinessToast(option.label, outcome.readiness)
          if (live.current) {
            onReadyRef.current(getProjectHostSetupSelectionKey({ id: outcome.setup, hostId }))
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof ReportedError
              ? translate(
                  'fork.serverSetup.cloneFailed',
                  'The clone did not finish. See the error above.'
                )
              : error instanceof Error
                ? error.message
                : String(error)
          if (!(error instanceof ReportedError)) {
            toast.error(
              translate('fork.serverSetup.failedTitle', 'Could not set up on {{host}}', {
                host: option.label
              }),
              { description: message }
            )
          }
          if (live.current) {
            setErrors((current) => new Map(current).set(hostId, message))
          }
          if (!(error instanceof ForkServerSetupError) && !(error instanceof ReportedError)) {
            console.error('Fork server setup failed:', error)
          }
        })
        .finally(() => {
          if (live.current) {
            setProgress((current) => without(current, hostId))
          }
        })
    },
    [parent, progress, project, settings, url]
  )

  return { offered, parent, progress, errors, start }
}
