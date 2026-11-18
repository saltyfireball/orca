// Batch start (FORK.md, SLRM-2395): the composer's batch box. Type a prompt, pick one or more
// models, and Start (or Cmd/Ctrl+Enter, which always keeps the box open with a fresh draft). Each
// model gets its own worktree and agent on the machine auto placement picks, or on the composer's
// run target. The box clears only after the machine acknowledges every start.
import React, { useCallback, useMemo } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SwitchIndicator } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ButtonKeyHint } from '@/components/ButtonKeyHint'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import {
  getScreenSubmitModifierLabel,
  isScreenSubmitShortcut
} from '@/lib/keyboard/screen-submit-shortcut'
import type { NewWorkspaceProjectOption } from '@/lib/workspace/creation/new-workspace-project-options'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../../shared/agent-launch/catalog/tui-agent-selection'
import {
  FORK_BATCH_START_MAX_AGENTS,
  readForkBatchStartSettings
} from '../../../../shared/fork/batch-start'
import { sendForkBatchStart } from './fork-batch-start-client'
import { useForkBatchStart } from '../../../../shared/fork/use-fork-batch-start'

export type ForkBatchStartBoxProps = {
  projectOptions: readonly NewWorkspaceProjectOption[]
  selectedProjectId: string | null
  onProjectChange: (value: string) => void
  repoId: string
  hostId: string | null
  selectedRepoIsGit: boolean
  detectedAgentIds: ReadonlySet<TuiAgent> | null
  initialAgent: TuiAgent | null
  onClose: () => void
}

function SwitchButton(props: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
      className="group flex w-fit cursor-pointer items-center gap-2 rounded-md text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <SwitchIndicator checked={props.checked} />
      <span className="text-muted-foreground transition-colors group-hover:text-foreground">
        {props.label}
      </span>
    </button>
  )
}

export function ForkBatchStartBox(props: ForkBatchStartBoxProps): React.JSX.Element {
  const t = useTranslate()
  const settings = useAppStore((state) => state.settings)
  const disabledTuiAgents = settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  const config = readForkBatchStartSettings(settings)
  const projects = props.projectOptions.filter(
    (option): option is Extract<NewWorkspaceProjectOption, { kind: 'project' }> =>
      option.kind === 'project'
  )
  const project = projects.find((option) => option.id === props.selectedProjectId) ?? null
  const offered = useMemo(() => {
    const catalog = getAgentCatalog()
    const enabled = new Set(
      filterEnabledTuiAgents(
        catalog.map((entry) => entry.id),
        disabledTuiAgents
      )
    )
    return catalog.filter(
      (entry) =>
        enabled.has(entry.id) &&
        (props.detectedAgentIds === null || props.detectedAgentIds.has(entry.id))
    )
  }, [disabledTuiAgents, props.detectedAgentIds])
  const labelOf = useCallback(
    (agent: TuiAgent): string => offered.find((entry) => entry.id === agent)?.label ?? agent,
    [offered]
  )
  const { repoId, hostId } = props
  const projectId = project?.projectId ?? null
  const projectName = project?.displayName
  const setupMissing = config.setupMissing
  const send = useCallback(
    (prompt: string, agents: TuiAgent[], auto: boolean) => {
      if (!projectId) {
        return Promise.reject(new Error('Pick a project first.'))
      }
      return sendForkBatchStart(
        { project: { id: projectId, name: projectName }, repoId, hostId },
        auto,
        prompt,
        agents,
        setupMissing
      )
    },
    [hostId, projectId, projectName, repoId, setupMissing]
  )
  const batch = useForkBatchStart({
    config,
    initialAgents: props.initialAgent ? [props.initialAgent] : offered.slice(0, 1).map((e) => e.id),
    labelOf,
    send
  })
  const { onClose } = props
  const start = useCallback(
    async (background: boolean): Promise<void> => {
      if ((await batch.submit(background)) === 'close') {
        onClose()
      }
    },
    [batch, onClose]
  )
  const blocked = !project
    ? t('fork.batchStart.pickProject', 'Pick a project first.')
    : !props.selectedRepoIsGit
      ? t('fork.batchStart.gitOnly', 'Batch start makes git worktrees; pick a git project.')
      : batch.agents.length === 0
        ? t('fork.batchStart.pickModel', 'Pick at least one model.')
        : null
  const canStart = !blocked && !batch.sending && batch.prompt.trim().length > 0
  const atMax = batch.agents.length >= FORK_BATCH_START_MAX_AGENTS

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-2 pt-3">
      <div className="min-w-0 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('fork.batchStart.project', 'Project')}
        </label>
        <Select value={project?.id ?? ''} onValueChange={props.onProjectChange}>
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue placeholder={t('fork.batchStart.pickProject', 'Pick a project first.')} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((option) => (
              <SelectItem key={option.id} value={option.id} className="text-xs">
                {option.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('fork.batchStart.prompt', 'Prompt')}
        </label>
        <Textarea
          autoFocus
          rows={5}
          value={batch.prompt}
          readOnly={batch.sending}
          onChange={(event) => batch.setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (isScreenSubmitShortcut(event)) {
              event.preventDefault()
              event.stopPropagation()
              if (canStart) {
                void start(true)
              }
            }
          }}
          placeholder={t(
            'fork.batchStart.placeholder',
            'What should the agent do? {{key}} Enter starts it and opens a fresh draft.',
            { key: getScreenSubmitModifierLabel() }
          )}
          className="text-sm"
        />
      </div>
      <div className="min-w-0 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('fork.batchStart.models', 'Models (one task each)')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {offered.map((entry) => {
            const picked = batch.agents.includes(entry.id)
            return (
              <Button
                key={entry.id}
                type="button"
                size="xs"
                variant={picked ? 'secondary' : 'outline'}
                aria-pressed={picked}
                disabled={batch.sending || (!picked && atMax)}
                onClick={() => batch.toggleAgent(entry.id)}
              >
                {entry.label}
              </Button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <SwitchButton
          checked={batch.auto}
          onChange={batch.setAuto}
          label={t('fork.batchStart.autoHost', 'Auto machine')}
        />
        <SwitchButton
          checked={batch.keepOpen}
          onChange={batch.setKeepOpen}
          label={t('fork.batchStart.keepOpen', 'Keep open')}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {batch.auto
          ? t(
              'fork.batchStart.autoHelp',
              'Starts on this machine or a paired server, whichever has the most spare CPU and memory.'
            )
          : t(
              'fork.batchStart.hereHelp',
              'Starts on the run target picked for this project (switch Batch off to change it).'
            )}
      </p>
      {batch.error || blocked ? (
        <div
          role="alert"
          className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {batch.error ?? blocked}
        </div>
      ) : null}
      {batch.acks.length > 0 ? (
        <ul
          aria-label={t('fork.batchStart.started', 'Started')}
          className="min-h-0 space-y-1.5 overflow-y-auto text-xs scrollbar-sleek"
        >
          {batch.acks.map((ack) => (
            <li key={ack.id} className="rounded-md border border-border px-2 py-1.5">
              <div className="truncate font-medium">{ack.excerpt}</div>
              {ack.lines.map((line) => (
                <div key={line} className="truncate text-muted-foreground">
                  {line}
                </div>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex shrink-0 justify-end">
        <Button
          size="sm"
          className="text-xs"
          disabled={!canStart}
          onClick={() => void start(false)}
        >
          {batch.sending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {t('fork.batchStart.start', 'Start')}
          <ButtonKeyHint modifierLabel={getScreenSubmitModifierLabel()} />
        </Button>
      </div>
    </div>
  )
}
