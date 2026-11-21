// BAD-703 (FORK.md "Tasks GitHub list: one slow project cannot block the rest"): one row per project
// that gave nothing, with why and a Retry, above the list rows that did load.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { GitHubFailedSource } from '../../../../shared/fork/github-source-deadline'

export function ForkGitHubSourceErrors({
  failedSources,
  labelForRepo,
  onRetry,
  disabled
}: {
  failedSources: readonly GitHubFailedSource[]
  labelForRepo: (repoId: string) => string
  onRetry: () => void
  disabled: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  if (failedSources.length === 0) {
    return null
  }
  return (
    <>
      {failedSources.map((source) => (
        <div
          key={`fork-source-failed-${source.repoId}`}
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200"
        >
          <span>
            <span className="font-mono">{labelForRepo(source.repoId)}</span>{' '}
            {source.reason === 'timeout'
              ? t(
                  'fork.taskPage.sourceTimedOut',
                  'did not answer in time. The rest of the list is shown.'
                )
              : t('fork.taskPage.sourceFailed', "couldn't load: {{message}}", {
                  message: source.message
                })}
          </span>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled}>
            {t('fork.taskPage.sourceRetry', 'Retry')}
          </Button>
        </div>
      ))}
    </>
  )
}
