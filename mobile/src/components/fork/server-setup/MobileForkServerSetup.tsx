// Set up on a server (FORK.md, SLRM-2406) on the phone: "Set up on SERVER..." rows in the
// new-workspace sheet's run-target list, for each reachable paired server that lacks the project.
// Picking one plans the folder on the server, has the paired desktop clone and register it there
// (fork.serverSetup.run), checks readiness on the server, then picks that server as the run target.
// Progress, the outcome and any failure show in the sheet (Alert does nothing in the web session).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Text } from 'react-native'
import type { ExecutionHostId } from '../../../../../src/shared/execution-host/execution-host'
import {
  forkServerSetupOffered,
  forkServerSetupParent,
  forkServerSetupReadinessOn,
  readForkServerSetupSettingsFrom
} from '../../../../../src/shared/fork/server-setup'
import {
  describeForkServerSetupRun,
  type ForkServerSetupRunResult
} from '../../../../../src/shared/fork/server-setup-wire'
import {
  ForkServerSetupError,
  isForkMethodMissing,
  runForkServerSetup,
  type ForkServerSetupStage
} from '../../../../../src/shared/fork/server-setup-flow'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { ListGroup, ListRow, SectionHeader } from '../../list/ListGroup'
import { newWorktreeFormStyles as styles } from '../../../new-workspace/creation/forms/new-worktree-form-styles'
import type { MobileWorkspaceRepo } from '../../../new-workspace/creation/forms/new-worktree-modal-types'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import {
  planMobileForkServerSetup,
  readMobileForkServerSetupReadiness,
  runMobileForkServerSetup
} from './mobile-fork-server-setup-operations'
import {
  findMobileForkSetUpRepo,
  mobileForkServerSetupHosts,
  mobileForkServerSetupItemId,
  mobileForkServerSetupUrl,
  type MobileForkServerSetupItem
} from './mobile-fork-server-setup-rows'

type ServerHostId = MobileForkServerSetupItem['hostId']

const NO_SERVERS: ReadonlyMap<ExecutionHostId, RpcClient> = new Map()

type Entry = {
  projectId: string
  serverName: string
  stage: ForkServerSetupStage | null
  folder: string | null
  error: string | null
  /** The finished setup's line, kept until the sheet closes. */
  done: string | null
  /** The new repo was picked as the run target (or the server never listed it). */
  picked: boolean
}

/** Bumps the server repo lists' generation once a setup lands, so the new repo is listed. */
export function useMobileForkServerRefresh(): { generation: number; refresh: () => void } {
  const [generation, setGeneration] = useState(0)
  const refresh = useCallback(() => setGeneration((current) => current + 1), [])
  return { generation, refresh }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useMobileForkServerSetup(args: {
  desktopClient: RpcClient | null
  serverClients?: ReadonlyMap<ExecutionHostId, RpcClient>
  /** Servers whose own repo list has answered. */
  listedServers: { has: (hostId: ExecutionHostId) => boolean }
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
  /** Every listed repo, the desktop's and each server's. */
  repos: readonly MobileWorkspaceRepo[]
  selectedProjectId: string | null
  /** The paired host's settings, as the sheet read them. */
  runtimeSettings: unknown
  refreshServers: () => void
  onSetUp: (repo: MobileWorkspaceRepo) => void
}): {
  items: MobileForkServerSetupItem[]
  start: (item: MobileForkServerSetupItem) => void
  status: ReactNode
} {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const {
    desktopClient,
    serverClients = NO_SERVERS,
    listedServers,
    hostLabelById,
    repos,
    selectedProjectId,
    refreshServers,
    onSetUp
  } = args
  const settings = readForkServerSetupSettingsFrom(args.runtimeSettings)
  const offered = forkServerSetupOffered(settings)
  const parent = forkServerSetupParent(settings)
  const readinessOn = forkServerSetupReadinessOn(settings)
  const url = useMemo(
    () => mobileForkServerSetupUrl(repos, selectedProjectId),
    [repos, selectedProjectId]
  )
  const [entries, setEntries] = useState<ReadonlyMap<ServerHostId, Entry>>(new Map())
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const patch = useCallback((hostId: ServerHostId, change: Partial<Entry>): void => {
    if (!live.current) {
      return
    }
    setEntries((current) => {
      const entry = current.get(hostId)
      return entry ? new Map(current).set(hostId, { ...entry, ...change }) : current
    })
  }, [])

  const nameOf = useCallback(
    (hostId: ServerHostId): string => hostLabelById?.get(hostId) ?? hostId.slice('runtime:'.length),
    [hostLabelById]
  )

  const hosts = useMemo(
    () =>
      offered && url && desktopClient
        ? mobileForkServerSetupHosts({
            serverHostIds: serverClients.keys(),
            listedHostIds: listedServers,
            repos,
            projectId: selectedProjectId
          })
        : [],
    [desktopClient, listedServers, offered, repos, selectedProjectId, serverClients, url]
  )

  const items = useMemo(
    () =>
      hosts.map((hostId): MobileForkServerSetupItem => {
        const entry = entries.get(hostId)
        const busy = entry?.projectId === selectedProjectId && entry.stage !== null
        return {
          id: mobileForkServerSetupItemId(hostId),
          label: t('fork.serverSetup.rowLabel', 'Set up on {{host}}...', { host: nameOf(hostId) }),
          detail: busy
            ? t('fork.serverSetup.mobileBusy', 'Setting up; see the sheet')
            : t('fork.serverSetup.detail', "Clone from the project's git remote into {{folder}}", {
                folder: `${parent}/...`
              }),
          hostId,
          forkServerSetup: true
        }
      }),
    [entries, hosts, nameOf, parent, selectedProjectId, t]
  )

  const start = useCallback(
    (item: MobileForkServerSetupItem): void => {
      const hostId = item.hostId
      const serverClient = serverClients.get(hostId)
      const projectId = selectedProjectId
      const current = entries.get(hostId)
      if (!serverClient || !desktopClient || !projectId || !url || current?.stage) {
        return
      }
      const serverName = nameOf(hostId)
      setEntries((previous) =>
        new Map(previous).set(hostId, {
          projectId,
          serverName,
          stage: 'planning',
          folder: null,
          error: null,
          done: null,
          picked: false
        })
      )
      void runForkServerSetup<ForkServerSetupRunResult>(
        {
          plan: (params) => planMobileForkServerSetup(serverClient, params),
          clone: async () => {
            try {
              return await runMobileForkServerSetup(desktopClient, {
                environmentId: hostId.slice('runtime:'.length),
                project: projectId
              })
            } catch (error) {
              if (isForkMethodMissing(error)) {
                throw new ForkServerSetupError(
                  t(
                    'fork.serverSetup.mobileDesktopOld',
                    'The paired desktop runs a Blackfish that cannot set servers up from the phone. Update it.'
                  )
                )
              }
              throw error
            }
          },
          ...(readinessOn
            ? {
                readiness: (path: string) => readMobileForkServerSetupReadiness(serverClient, path)
              }
            : {}),
          onStage: (stage, plan) => patch(hostId, { stage, folder: plan?.clonePath ?? null })
        },
        { url, parent, serverName }
      )
        .then((outcome) => {
          patch(hostId, {
            stage: null,
            done: describeForkServerSetupRun({ ...outcome.setup, readiness: outcome.readiness }),
            error: outcome.readinessError
              ? t('fork.serverSetup.mobileReadinessFailed', 'Readiness check failed: {{reason}}', {
                  reason: outcome.readinessError
                })
              : null
          })
          refreshServers()
        })
        .catch((error: unknown) => {
          patch(hostId, { stage: null, error: messageOf(error) })
        })
    },
    [
      desktopClient,
      entries,
      nameOf,
      parent,
      patch,
      readinessOn,
      refreshServers,
      selectedProjectId,
      serverClients,
      url
    ]
  )

  // Once the server lists the new repo, pick it, so the launch goes on there.
  useEffect(() => {
    for (const [hostId, entry] of entries) {
      if (!entry.done || entry.picked) {
        continue
      }
      const repo = findMobileForkSetUpRepo(repos, hostId, entry.projectId)
      if (repo) {
        patch(hostId, { picked: true })
        if (entry.projectId === selectedProjectId) {
          onSetUp(repo)
        }
      }
    }
  }, [entries, onSetUp, patch, repos, selectedProjectId])

  const shown = [...entries].filter(([, entry]) => entry.projectId === selectedProjectId)
  const status =
    shown.length === 0 ? null : (
      <>
        <SectionHeader title={t('fork.serverSetup.mobileSection', 'Set up on a server')} />
        <ListGroup>
          {shown.map(([hostId, entry]) => (
            <ListRow
              key={hostId}
              title={
                entry.stage
                  ? t('fork.serverSetup.mobileWorking', 'Setting up on {{host}}', {
                      host: entry.serverName
                    })
                  : entry.done
                    ? t('fork.serverSetup.doneTitle', 'Set up on {{host}}', {
                        host: entry.serverName
                      })
                    : t('fork.serverSetup.failedTitle', 'Could not set up on {{host}}', {
                        host: entry.serverName
                      })
              }
              subtitle={
                entry.stage === 'planning'
                  ? t('fork.serverSetup.planning', 'Choosing a folder...')
                  : entry.stage === 'cloning'
                    ? t('fork.serverSetup.cloning', 'Cloning into {{folder}}...', {
                        folder: entry.folder ?? `${parent}/...`
                      })
                    : entry.stage === 'checking'
                      ? t('fork.serverSetup.checking', 'Checking what the project needs...')
                      : (entry.done ?? undefined)
              }
              busy={entry.stage !== null}
            />
          ))}
        </ListGroup>
        {shown.flatMap(([hostId, entry]) =>
          entry.error ? (
            <Text key={`error:${hostId}`} style={styles.error}>
              {entry.error}
            </Text>
          ) : (
            []
          )
        )}
      </>
    )

  return { items, start, status }
}
