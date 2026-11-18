// Review guides (SLRM-2396, FORK.md): one stop of the Guide tab. Each file shows GitHub's own
// viewed mark; "Mark viewed" sends the stock viewed toggle and runs only on the user's click.
import type React from 'react'
import { Check, CircleAlert, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeChatDiffView } from '@/components/native-chat/tools/diffs/NativeChatDiffView'
import { useTranslate } from '@/i18n/use-translate'
import type {
  ForkReviewGuideFile,
  ForkReviewGuideStop as Stop
} from '../../../../shared/fork/review-guide'
import type { GitHubPRFile } from '../../../../shared/github/pull-requests/pull-request-types'

export type ForkReviewGuideViewed = {
  files: GitHubPRFile[]
  pendingViewedPaths: ReadonlySet<string>
  onViewedChange: (path: string, viewed: boolean) => Promise<boolean>
}

function rangesLabel(lines: [number, number][]): string {
  return lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
}

function FileViewedControl({
  path,
  viewed
}: {
  path: string
  viewed: ForkReviewGuideViewed
}): React.JSX.Element | null {
  const t = useTranslate()
  const file = viewed.files.find((entry) => entry.path === path)
  if (!file || file.viewerViewedState === undefined) {
    return null
  }
  if (file.viewerViewedState === 'VIEWED') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="size-3" />
        {t('fork.reviewGuide.viewed', 'Viewed')}
      </span>
    )
  }
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={viewed.pendingViewedPaths.has(path)}
      onClick={() => void viewed.onViewedChange(path, true)}
    >
      {file.viewerViewedState === 'DISMISSED'
        ? t('fork.reviewGuide.changedMarkViewed', 'Changed since viewed: mark viewed')
        : t('fork.reviewGuide.markViewed', 'Mark viewed')}
    </Button>
  )
}

function GuideFile({
  file,
  showExcerpt,
  viewed
}: {
  file: ForkReviewGuideFile
  showExcerpt: boolean
  viewed: ForkReviewGuideViewed
}): React.JSX.Element {
  const ranges = rangesLabel(file.lines)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[12px]">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.path}</span>
          {ranges ? <span className="shrink-0 text-muted-foreground">:{ranges}</span> : null}
        </div>
        <FileViewedControl path={file.path} viewed={viewed} />
      </div>
      {showExcerpt && file.excerpt.length > 0 ? (
        <NativeChatDiffView
          lines={file.excerpt.map((line) => ({
            kind: line.sign === '+' ? 'add' : line.sign === '-' ? 'del' : 'context',
            text: line.text
          }))}
        />
      ) : null}
    </div>
  )
}

export function ForkReviewGuideStop({
  stop,
  showExcerpts,
  viewed
}: {
  stop: Stop
  showExcerpts: boolean
  viewed: ForkReviewGuideViewed
}): React.JSX.Element {
  const t = useTranslate()
  const unviewed = stop.files.filter((file) => {
    const state = viewed.files.find((entry) => entry.path === file.path)?.viewerViewedState
    return state !== undefined && state !== 'VIEWED' && !viewed.pendingViewedPaths.has(file.path)
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold">{stop.title}</h3>
        {stop.lookClosely ? (
          <Badge variant="warning">
            <CircleAlert />
            {t('fork.reviewGuide.lookClosely', 'Look closely')}
          </Badge>
        ) : null}
      </div>
      {stop.lookClosely ? (
        <p className="text-[12px] text-status-warning-text">{stop.lookClosely}</p>
      ) : null}
      {stop.body ? (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{stop.body}</p>
      ) : null}
      <div className="space-y-3">
        {stop.files.map((file) => (
          <GuideFile key={file.path} file={file} showExcerpt={showExcerpts} viewed={viewed} />
        ))}
      </div>
      {unviewed.length > 1 ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            for (const file of unviewed) {
              void viewed.onViewedChange(file.path, true)
            }
          }}
        >
          <Check className="size-3.5" />
          {t('fork.reviewGuide.markStopViewed', "Mark this stop's files viewed")}
        </Button>
      ) : null}
    </div>
  )
}
