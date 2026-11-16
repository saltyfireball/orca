// The fork Settings pane's one project list. Each project is a closed row that opens to every
// setting the fork keeps per project, so a feature never lists the projects again. The list has
// a fixed height and a filter, which keeps the pane short however many projects there are.
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import { isFolderRepo } from '../../../../shared/repository/repo-kind'
import { SettingsSubsectionHeader } from '@/components/settings/form-controls/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  ForkMcpProjectProfileRow,
  forkMcpProjectProfileOf
} from '../mcp-profiles/ForkMcpProjectProfileRow'
import { ForkLostWorkBranchRow, forkLostWorkBranchOf } from '../lost-work/ForkLostWorkBranchRow'

/** The filter field shows from this many projects on; fewer are all in view at once. */
const FILTER_FROM_PROJECTS = 8

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** What a closed row says about its project: the values set for it, or that none is. */
function projectSummary(settings: GlobalSettings, repo: Repo, t: Translate): string {
  const profile = forkMcpProjectProfileOf(settings, repo.path)
  const branch = forkLostWorkBranchOf(settings, repo.id)
  const parts = [
    profile ? t('fork.settingsPane.projectList.mcp', 'MCP: {{profile}}', { profile }) : '',
    branch ? t('fork.settingsPane.projectList.branch', 'Branch: {{branch}}', { branch }) : ''
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : t('fork.settingsPane.projectList.defaults', 'Defaults')
}

function ForkProjectSettingsItem({
  settings,
  updateSettings,
  repo,
  open,
  onToggle
}: Props & { repo: Repo; open: boolean; onToggle: () => void }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div data-fork-project-settings={repo.id}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="truncate font-medium">{repo.displayName || repo.path}</span>
        <span className="ml-auto shrink-0 truncate pl-3 text-xs text-muted-foreground">
          {projectSummary(settings, repo, t)}
        </span>
      </button>
      {/* Mounted only while open: a long project list stays cheap, and nothing in it is searched. */}
      {open ? (
        <div className="border-t border-border bg-background/40 py-1 pl-8 pr-3">
          <p className="select-text truncate pt-2 text-xs text-muted-foreground">{repo.path}</p>
          <ForkMcpProjectProfileRow
            settings={settings}
            updateSettings={updateSettings}
            repo={repo}
          />
          <ForkLostWorkBranchRow settings={settings} updateSettings={updateSettings} repo={repo} />
        </div>
      ) : null}
    </div>
  )
}

export function ForkProjectSettingsList({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const repos = useAppStore((s) => s.repos).filter((repo) => !isFolderRepo(repo))
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? repos.filter((repo) => `${repo.displayName}\n${repo.path}`.toLowerCase().includes(needle))
    : repos
  const toggle = (id: string): void =>
    setOpenIds((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.settingsPane.projectList.title', 'Per project')}
        description={t(
          'fork.settingsPane.projectList.description',
          'Open a project to set its MCP profile and its Lost work default branch. A project left alone follows the defaults.'
        )}
      />
      {repos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('fork.settingsPane.projectList.empty', 'No projects added yet.')}
        </p>
      ) : (
        <>
          {repos.length >= FILTER_FROM_PROJECTS ? (
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('fork.settingsPane.projectList.filter', 'Filter projects')}
              aria-label={t('fork.settingsPane.projectList.filter', 'Filter projects')}
              className="h-8"
            />
          ) : null}
          <div
            data-fork-project-settings-list=""
            className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border scrollbar-sleek"
          >
            {shown.map((repo) => (
              <ForkProjectSettingsItem
                key={repo.id}
                settings={settings}
                updateSettings={updateSettings}
                repo={repo}
                open={openIds.has(repo.id)}
                onToggle={() => toggle(repo.id)}
              />
            ))}
            {shown.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t('fork.settingsPane.projectList.noMatch', 'No project matches.')}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
