// Digest (SLRM-2388, FORK.md): the phone's digest of a host and its paired servers: what waits on
// you, what failed, finished and merged, open pull requests and the estimated cost. Built from the
// Accounts screen's parts (NavBar, ListGroup rows, load states) so it looks like the rest.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { useForceReconnect, useHostClient } from '../../../transport/connection/host-client-hooks'
import { peekHosts } from '../../../host-catalog/host-store'
import { MobileAccountsLoadState } from '../../../accounts/MobileAccountsLoadState'
import { MobileLoadErrorState, MobileStateView } from '../../feedback/MobileStateView'
import { NavBar } from '../../nav-bar/NavBar'
import { NavBarButton } from '../../nav-bar/NavBarButton'
import { ListGroup, ListRow, SectionHeader } from '../../list/ListGroup'
import { useRouteHandoff } from '../../../navigation/route-handoff'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, spacing } from '../../../theme/mobile-theme'
import { styles } from '../../../accounts/mobile-accounts-screen-styles'
import {
  FORK_DIGEST_CALL_TIMEOUT_MS,
  type ForkDigest,
  type ForkDigestHost
} from '../../../../../src/shared/fork/digest'
import { formatForkUsd } from '../../../../../src/shared/fork/usage-report'
import { forkDigestRead } from './fork-digest-read'

type T = ReturnType<typeof useMobileTranslation>

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function hostStatus(host: ForkDigestHost, t: T): string | undefined {
  if (host.status === 'unreachable') {
    return t('fork.digest.unreachable', 'Not answering')
  }
  if (host.status === 'no-digest') {
    return t('fork.digest.noDigest', 'No digest here: stock Orca or an older Blackfish')
  }
  return undefined
}

function HostRows({ host, t, first }: { host: ForkDigestHost; t: T; first: boolean }) {
  const section = host.section
  const rows: { key: string; title: string; subtitle?: string; url?: string }[] = []
  if (section) {
    for (const row of section.waiting) {
      rows.push({
        key: `w:${row.chatId}`,
        title: t('fork.digest.waitingRow', 'Waiting: {{title}}', {
          title: row.title || row.chatId
        }),
        subtitle: row.question
      })
    }
    for (const task of section.tasks) {
      rows.push({
        key: `t:${task.id}`,
        title:
          task.status === 'failed'
            ? t('fork.digest.failedRow', 'Failed: {{title}}', { title: task.title })
            : t('fork.digest.finishedRow', 'Finished: {{title}}', { title: task.title }),
        subtitle: when(task.at)
      })
    }
    for (const pr of section.pullRequests) {
      rows.push({
        key: `p:${pr.url}`,
        title:
          pr.state === 'merged'
            ? t('fork.digest.mergedRow', 'Merged: {{title}}', { title: pr.title })
            : t('fork.digest.openRow', 'Open: {{title}}', { title: pr.title }),
        subtitle: `${pr.repo}#${pr.number}`,
        url: pr.url
      })
    }
    if (section.cost) {
      const cost = section.cost
      rows.push({
        key: 'cost',
        title: t('fork.digest.costRow', 'Cost (estimate): {{money}}', {
          money: cost.costUsd === null ? '-' : formatForkUsd(cost.costUsd)
        }),
        subtitle: t('fork.digest.costDetail', '{{days}} d, {{chats}} chats', {
          days: cost.days,
          chats: cost.chats
        })
      })
    }
  }
  return (
    <View>
      <SectionHeader title={host.name} first={first} />
      <ListGroup style={styles.group}>
        {rows.length === 0 ? (
          <ListRow
            title={hostStatus(host, t) ?? t('fork.digest.nothing', 'Nothing in this window.')}
          />
        ) : (
          rows.map(({ key, title, subtitle, url }) => (
            <ListRow
              key={key}
              title={title}
              subtitle={subtitle}
              navigates={url !== undefined}
              onPress={url === undefined ? undefined : () => void Linking.openURL(url)}
            />
          ))
        )}
      </ListGroup>
      {section?.notes.map((note) => (
        <Text key={note} style={styles.footerHintText}>
          {note}
        </Text>
      ))}
    </View>
  )
}

export function MobileForkDigestScreen() {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const { client, state: connState } = useHostClient(hostId)
  const forceReconnect = useForceReconnect()
  const hostName = peekHosts()?.find((host) => host.id === hostId)?.name ?? ''
  const [digest, setDigest] = useState<ForkDigest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!client || connState !== 'connected') {
      return
    }
    setLoading(true)
    try {
      const response = await forkDigestRead.request(
        client,
        {},
        { timeoutMs: FORK_DIGEST_CALL_TIMEOUT_MS }
      )
      setDigest(forkDigestRead.interpret(response))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [client, connState])

  useEffect(() => {
    void load()
  }, [load])

  const totals = digest?.totals
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <NavBar
        leading={
          <NavBarButton
            icon={ChevronLeft}
            onPress={() => router.back()}
            accessibilityLabel={t('fork.digest.back', 'Back')}
          />
        }
        title={t('fork.digest.screenTitle', 'Digest')}
        subtitle={hostName || undefined}
        trailing={
          <NavBarButton
            icon={loading ? RefreshingIcon : RefreshCw}
            onPress={() => void load()}
            disabled={!client || loading || connState !== 'connected'}
            accessibilityLabel={t('fork.digest.refresh', 'Refresh')}
          />
        }
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          !digest && { flexGrow: 1 },
          { paddingBottom: insets.bottom + spacing.xl }
        ]}
      >
        {digest && totals ? (
          <>
            <Text style={styles.footerHintText}>
              {t('fork.digest.window', '{{since}} to {{until}}', {
                since: when(digest.since),
                until: when(digest.until)
              })}
            </Text>
            <ListGroup style={styles.group}>
              <ListRow
                title={t(
                  'fork.digest.headline',
                  '{{finished}} finished, {{failed}} failed, {{merged}} merged, {{open}} open, {{waiting}} waiting on you',
                  totals
                )}
                value={totals.costUsd === null ? undefined : formatForkUsd(totals.costUsd)}
              />
              {digest.serversDown.map((server) => (
                <ListRow
                  key={server.name}
                  title={t('fork.digest.serverDown', '{{name}} is not answering since {{since}}', {
                    name: server.name,
                    since: when(server.downSince)
                  })}
                />
              ))}
            </ListGroup>
            {digest.hosts.map((host, index) => (
              <HostRows key={host.hostKey} host={host} t={t} first={index === 0} />
            ))}
          </>
        ) : error && connState === 'connected' ? (
          <MobileLoadErrorState error={error} onRetry={() => void load()} />
        ) : connState === 'connected' ? (
          <MobileStateView
            loading
            title={t('fork.digest.loading', 'Asking this host and its servers...')}
          />
        ) : (
          <MobileAccountsLoadState
            connState={connState}
            hostName={hostName}
            error={null}
            onRetry={() => void load()}
            onReconnect={hostId && forceReconnect ? () => void forceReconnect(hostId) : null}
            onRepair={() => router.push('/pair-scan')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function RefreshingIcon({ color }: { color?: string }) {
  return <ActivityIndicator size="small" color={color ?? colors.textSecondary} />
}
