// Review guides (SLRM-2396, FORK.md): the Guide tab on the pull request page. Two hooks in the
// stock tabs shell render its trigger and its content; everything else is here. A guide is
// written only when the user asks (or turned on automatic guides), and files are marked viewed on
// GitHub only by the user's own click.
import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Compass, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  resolvePullRequestRepo,
  type GitHubWorkItemProjectOrigin
} from '@/components/github/github-work-item-identity'
import { readForkReviewGuideSettings } from '../../../../shared/fork/review-guide'
import type { GitHubWorkItem } from '../../../../shared/github/work-items/work-item-types'
import { ForkReviewGuideStop, type ForkReviewGuideViewed } from './ForkReviewGuideStop'
import { forkReviewGuidesAvailable, useForkReviewGuide } from './use-fork-review-guide'

export const FORK_REVIEW_GUIDE_TAB = 'fork-guide'

function useGuideTabShown(repoId: string | null): boolean {
  const enabled = useAppStore((s) => readForkReviewGuideSettings(s.settings).enabled)
  return enabled && !!repoId && forkReviewGuidesAvailable()
}

export function ForkReviewGuideTabTrigger({
  repoId
}: {
  repoId: string | null
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!useGuideTabShown(repoId)) {
    return null
  }
  return (
    <TabsTrigger value={FORK_REVIEW_GUIDE_TAB} className="px-3 py-2.5">
      <Compass className="size-3.5" />
      {t('fork.reviewGuide.tab', 'Guide')}
    </TabsTrigger>
  )
}

type ContentProps = ForkReviewGuideViewed & {
  tab: string
  workItem: GitHubWorkItem
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
  repoId: string | null
  headSha: string | undefined
}

export function ForkReviewGuideTabContent(props: ContentProps): React.JSX.Element | null {
  if (!useGuideTabShown(props.repoId)) {
    return null
  }
  return (
    <TabsContent value={FORK_REVIEW_GUIDE_TAB} className="mt-0">
      <GuideBody {...props} />
    </TabsContent>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

function GuideBody(props: ContentProps): React.JSX.Element {
  const t = useTranslate()
  const view = useForkReviewGuide({
    repoId: props.repoId,
    pr: props.workItem.number,
    prRepo: resolvePullRequestRepo(props.workItem, props.projectOrigin) ?? null,
    headSha: props.headSha,
    active: props.tab === FORK_REVIEW_GUIDE_TAB
  })
  const [index, setIndex] = useState(0)
  const guide = view.state?.guide ?? null
  useEffect(() => setIndex(0), [guide?.createdAt])
  const job = view.state?.job ?? null

  if (job?.state === 'running') {
    return (
      <Centered>
        <LoaderCircle className="size-5 animate-spin" />
        <div>
          {t(
            'fork.reviewGuide.writing',
            'Writing the guide. A large pull request takes a few minutes; you can leave this tab.'
          )}
        </div>
        <Button variant="outline" size="sm" disabled={view.busy} onClick={view.cancel}>
          {t('fork.reviewGuide.cancel', 'Cancel')}
        </Button>
      </Centered>
    )
  }
  const failure = job?.state === 'failed' ? job.error : view.error
  if (!guide) {
    if (!view.state && !view.error) {
      return (
        <Centered>
          <LoaderCircle className="size-5 animate-spin" />
        </Centered>
      )
    }
    return (
      <Centered>
        {failure ? <div className="text-destructive">{failure}</div> : null}
        <div className="max-w-md">
          {t(
            'fork.reviewGuide.empty',
            'No guide for this pull request yet. An agent reads the change and writes a tour of it: stops in reading order, the calls to look closely at, and mechanical changes at the end. It uses the source control pull request model and costs agent usage.'
          )}
        </div>
        <Button size="sm" disabled={view.busy} onClick={view.write}>
          <Sparkles className="size-3.5" />
          {failure
            ? t('fork.reviewGuide.retry', 'Try again')
            : t('fork.reviewGuide.write', 'Write guide')}
        </Button>
      </Centered>
    )
  }

  const pages = guide.stops.length + (guide.mechanical.length > 0 ? 1 : 0)
  const page = Math.min(index, pages - 1)
  const stale = view.state?.stale === true
  return (
    <div className="space-y-4 px-6 py-4">
      <div className="space-y-1">
        {guide.summary ? <p className="text-[13px] leading-relaxed">{guide.summary}</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {t('fork.reviewGuide.writtenBy', 'Written by {{agent}} for {{sha}}', {
              agent: guide.agentLabel,
              sha: guide.headSha.slice(0, 7)
            })}
          </span>
          <Button variant="ghost" size="xs" disabled={view.busy} onClick={view.write}>
            <RefreshCw />
            {t('fork.reviewGuide.rewrite', 'Rewrite guide')}
          </Button>
        </div>
        {stale ? (
          <div className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-[12px] text-status-warning-text">
            {t(
              'fork.reviewGuide.stale',
              'The pull request has new commits since this guide was written, so its excerpts are hidden. Rewrite it to follow the current change.'
            )}
          </div>
        ) : null}
        {failure ? <div className="text-[12px] text-destructive">{failure}</div> : null}
      </div>

      <div className="flex items-center gap-2 border-b border-border/60 pb-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setIndex(page - 1)}
        >
          <ArrowLeft className="size-3.5" />
          {t('fork.reviewGuide.back', 'Back')}
        </Button>
        <span className="flex-1 text-center text-[12px] text-muted-foreground">
          {page < guide.stops.length
            ? t('fork.reviewGuide.stopOf', 'Stop {{n}} of {{total}}', {
                n: page + 1,
                total: guide.stops.length
              })
            : t('fork.reviewGuide.mechanicalTitle', 'Mechanical changes')}
        </span>
        <Button size="sm" disabled={page >= pages - 1} onClick={() => setIndex(page + 1)}>
          {t('fork.reviewGuide.next', 'Next')}
          <ArrowRight className="size-3.5" />
        </Button>
      </div>

      {page < guide.stops.length ? (
        <ForkReviewGuideStop
          stop={guide.stops[page]}
          showExcerpts={!stale}
          viewed={{
            files: props.files,
            pendingViewedPaths: props.pendingViewedPaths,
            onViewedChange: props.onViewedChange
          }}
        />
      ) : (
        <div className="space-y-3">
          {guide.mechanical.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="text-[13px] font-semibold">{group.title}</div>
              <ul className="space-y-0.5 font-mono text-[12px] text-muted-foreground">
                {group.paths.map((path) => (
                  <li key={path} className="truncate">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
