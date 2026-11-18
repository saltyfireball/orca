// Review guides (SLRM-2396, FORK.md): the phone's guide. One row on the pull request tab opens a
// drawer that walks the stops with Back and Next. A stale guide offers a rewrite and hides its
// excerpts. "Mark viewed" sends the stock GitHub viewed toggle, only on the user's tap.
import { useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Compass, RefreshCw } from 'lucide-react-native'
import type { ForkReviewGuide } from '../../../../../src/shared/fork/review-guide'
import type { GitHubPRFile } from '../../../../../src/shared/github/pull-requests/pull-request-types'
import { BottomDrawer } from '../../bottom-drawer/BottomDrawer'
import { SheetHeader } from '../../nav-bar/SheetHeader'
import { SheetPrimaryButton } from '../../sheets/SheetPrimaryButton'
import { ListGroup, ListRow } from '../../list/ListGroup'
import { PrMiniButton } from '../../../source-control/review/pull-request/PrMiniButton'
import { PrThreadCode } from '../../../source-control/review/pull-request/comments/PrThreadCode'
import { fetchSetPRFileViewed } from '../../../source-control/review/github-operations/github-pr-review-line-mutations'
import type { PrSidebarData } from '../../../source-control/review/pull-request/mobile-pr-sidebar-state'
import {
  livePrDetails,
  type MobilePrTab
} from '../../../source-control/review/pull-request/use-mobile-pr-tab'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { useMobileReviewGuide, type MobileReviewGuide as Guide } from './use-mobile-review-guide'

export function MobileReviewGuideRow({ tab, data }: { tab: MobilePrTab; data: PrSidebarData }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [open, setOpen] = useState(false)
  const details = livePrDetails(data.details)
  const guide = useMobileReviewGuide({
    client: tab.client,
    connState: tab.connState,
    target: { worktreeId: tab.worktreeId, pr: data.pr.number, prRepo: data.pr.prRepo ?? null },
    headSha: details?.headSha ?? null,
    open
  })
  const state = guide.state
  if (state && !state.enabled) {
    return null
  }
  const subtitle =
    state?.job?.state === 'running'
      ? t('fork.reviewGuide.rowWriting', 'Writing...')
      : state?.guide
        ? state.stale
          ? t('fork.reviewGuide.rowStale', 'Written for an older commit')
          : t('fork.reviewGuide.rowStops', '{{count}} stops', { count: state.guide.stops.length })
        : (guide.error ?? t('fork.reviewGuide.rowNone', 'No guide yet'))
  return (
    <>
      <ListGroup>
        <ListRow
          title={t('fork.reviewGuide.rowTitle', 'Review guide')}
          subtitle={subtitle}
          leading={<Compass size={20} color={colors.textSecondary} strokeWidth={2} />}
          navigates
          onPress={() => setOpen(true)}
        />
      </ListGroup>
      <BottomDrawer visible={open} onClose={() => setOpen(false)} fillAvailable contentScrollable>
        <GuideDrawer tab={tab} files={details?.files ?? []} guide={guide} />
      </BottomDrawer>
    </>
  )
}

function GuideDrawer({
  tab,
  files,
  guide
}: {
  tab: MobilePrTab
  files: GitHubPRFile[]
  guide: Guide
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [page, setPage] = useState(0)
  const state = guide.state
  const title = t('fork.reviewGuide.rowTitle', 'Review guide')
  if (!state) {
    return (
      <>
        <SheetHeader title={title} />
        <View style={styles.center}>
          {guide.error ? (
            <Text style={styles.muted}>{guide.error}</Text>
          ) : (
            <ActivityIndicator color={colors.textSecondary} />
          )}
        </View>
      </>
    )
  }
  if (state.job?.state === 'running') {
    return (
      <>
        <SheetHeader title={title} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={styles.muted}>
            {t(
              'fork.reviewGuide.writing',
              'Writing the guide. A large pull request takes a few minutes; come back to check on it.'
            )}
          </Text>
          <PrMiniButton
            label={t('fork.reviewGuide.cancel', 'Cancel')}
            onPress={guide.cancel}
            busy={guide.busy}
          />
        </View>
      </>
    )
  }
  const failure = state.job?.state === 'failed' ? state.job.error : guide.error
  if (!state.guide) {
    return (
      <>
        <SheetHeader title={title} />
        <View style={styles.center}>
          {failure ? <Text style={styles.error}>{failure}</Text> : null}
          <Text style={styles.muted}>
            {t(
              'fork.reviewGuide.empty',
              'No guide yet. An agent reads the change and writes a tour of it: stops in reading order, the calls to look closely at, and mechanical changes at the end. It costs agent usage.'
            )}
          </Text>
        </View>
        <SheetPrimaryButton
          label={t('fork.reviewGuide.write', 'Write guide')}
          onPress={guide.write}
          busy={guide.busy}
        />
      </>
    )
  }
  return (
    <GuidePages
      tab={tab}
      files={files}
      guide={state.guide}
      stale={state.stale === true}
      page={page}
      setPage={setPage}
      rewrite={guide.write}
      busy={guide.busy}
      afterViewed={() => tab.refetch({ includeDetails: true })}
    />
  )
}

function GuidePages(props: {
  tab: MobilePrTab
  files: GitHubPRFile[]
  guide: ForkReviewGuide
  stale: boolean
  page: number
  setPage: (page: number) => void
  rewrite: () => void
  busy: boolean
  afterViewed: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { guide, tab } = props
  const pages = guide.stops.length + (guide.mechanical.length > 0 ? 1 : 0)
  const page = Math.min(props.page, pages - 1)
  const stop = page < guide.stops.length ? guide.stops[page] : null
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const details = tab.state.kind === 'ready' ? livePrDetails(tab.state.data.details) : null
  const markViewed = async (path: string): Promise<void> => {
    const pullRequestId = details?.pullRequestId
    if (!tab.client || !pullRequestId) {
      return
    }
    setPending((prev) => new Set(prev).add(path))
    const outcome = await fetchSetPRFileViewed(tab.client, tab.worktreeId, {
      pullRequestId,
      path,
      viewed: true,
      prRepo: tab.state.kind === 'ready' ? (tab.state.data.pr.prRepo ?? null) : null
    }).catch(() => ({ ok: false as const, error: '' }))
    setPending((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    if (outcome.ok) {
      props.afterViewed()
    }
  }
  return (
    <>
      <SheetHeader
        title={t('fork.reviewGuide.rowTitle', 'Review guide')}
        subtitle={
          stop
            ? t('fork.reviewGuide.stopOf', 'Stop {{n}} of {{total}}', {
                n: page + 1,
                total: guide.stops.length
              })
            : t('fork.reviewGuide.mechanicalTitle', 'Mechanical changes')
        }
      />
      <ScrollView contentContainerStyle={styles.body}>
        {props.stale ? (
          <View style={styles.staleRow}>
            <Text style={styles.warning}>
              {t(
                'fork.reviewGuide.stale',
                'The pull request has new commits since this guide was written, so its excerpts are hidden.'
              )}
            </Text>
            <PrMiniButton
              icon={RefreshCw}
              label={t('fork.reviewGuide.rewrite', 'Rewrite guide')}
              onPress={props.rewrite}
              busy={props.busy}
            />
          </View>
        ) : null}
        {page === 0 && guide.summary ? <Text style={styles.text}>{guide.summary}</Text> : null}
        {stop ? (
          <>
            <Text style={styles.title}>{stop.title}</Text>
            {stop.lookClosely ? (
              <View style={styles.lookRow}>
                <CircleAlert size={14} color={colors.statusAmber} strokeWidth={2.2} />
                <Text style={styles.warning}>
                  {t('fork.reviewGuide.lookClosely', 'Look closely')}: {stop.lookClosely}
                </Text>
              </View>
            ) : null}
            {stop.body ? <Text style={styles.text}>{stop.body}</Text> : null}
            {stop.files.map((file) => {
              const viewed = props.files.find(
                (entry) => entry.path === file.path
              )?.viewerViewedState
              const ranges = file.lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
              return (
                <View key={file.path} style={styles.file}>
                  <Text style={styles.path}>
                    {file.path}
                    {ranges ? `:${ranges}` : ''}
                  </Text>
                  {!props.stale ? <PrThreadCode lines={file.excerpt} /> : null}
                  {viewed === 'VIEWED' ? (
                    <View style={styles.lookRow}>
                      <Check size={14} color={colors.textMuted} strokeWidth={2.2} />
                      <Text style={styles.muted}>{t('fork.reviewGuide.viewed', 'Viewed')}</Text>
                    </View>
                  ) : viewed !== undefined ? (
                    <PrMiniButton
                      label={t('fork.reviewGuide.markViewed', 'Mark viewed')}
                      onPress={() => void markViewed(file.path)}
                      busy={pending.has(file.path)}
                    />
                  ) : null}
                </View>
              )
            })}
          </>
        ) : (
          guide.mechanical.map((group) => (
            <View key={group.title} style={styles.file}>
              <Text style={styles.title}>{group.title}</Text>
              {group.paths.map((path) => (
                <Text key={path} style={styles.path}>
                  {path}
                </Text>
              ))}
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrMiniButton
          icon={ArrowLeft}
          label={t('fork.reviewGuide.back', 'Back')}
          onPress={() => props.setPage(page - 1)}
          disabled={page === 0}
        />
        <PrMiniButton
          icon={ArrowRight}
          label={t('fork.reviewGuide.next', 'Next')}
          onPress={() => props.setPage(page + 1)}
          disabled={page >= pages - 1}
          bright
        />
      </View>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  center: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  body: { gap: spacing.md, padding: spacing.lg },
  title: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  text: { color: colors.textPrimary, fontSize: typography.bodySize, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: typography.metaSize, textAlign: 'center' },
  error: { color: colors.statusRed, fontSize: typography.metaSize, textAlign: 'center' },
  warning: { color: colors.statusAmber, fontSize: typography.metaSize, flexShrink: 1 },
  lookRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  staleRow: { gap: spacing.sm, alignItems: 'flex-start' },
  file: { gap: spacing.xs },
  path: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  }
}))
