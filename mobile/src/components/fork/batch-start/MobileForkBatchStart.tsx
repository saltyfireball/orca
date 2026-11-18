// Batch start (FORK.md, SLRM-2395) on the phone: a Batch switch in the new-workspace sheet and, while
// it is on, a prompt box in place of the single-workspace form. Each prompt becomes a worktree and
// agent per picked model; the prompt clears only after the host says every model started, and
// failures stay in the box with the failed models still picked.
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { TuiAgent } from '../../../../../src/shared/agent-launch/catalog/tui-agent'
import {
  FORK_BATCH_START_MAX_AGENTS,
  readForkBatchStartSettingsFrom
} from '../../../../../src/shared/fork/batch-start'
import { useForkBatchStart } from '../../../../../src/shared/fork/use-fork-batch-start'
import { getRepoExecutionHostId } from '../../../../../src/shared/execution-host/execution-host'
import { getProjectIdentityKey } from '../../../../../src/shared/project/host-setup/project-host-setup-projection'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { TextField } from '../../composer-input/TextField'
import { ListGroup, ListRow, LIST_LEADING_INSET, SectionHeader } from '../../list/ListGroup'
import { MobileSwitch } from '../../controls/MobileSwitch'
import { MobileAgentIcon } from '../../icons/MobileAgentIcon'
import { SheetPrimaryButton } from '../../sheets/SheetPrimaryButton'
import { newWorktreeFormStyles as styles } from '../../../new-workspace/creation/forms/new-worktree-form-styles'
import type { MobileWorkspaceRepo } from '../../../new-workspace/creation/forms/new-worktree-modal-types'
import type { NewWorktreeAgentOption } from '../../../new-workspace/creation/runtime/new-worktree-agent-selection'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import {
  mobileForkBatchRequest,
  sendMobileForkBatchStart
} from './mobile-fork-batch-start-operation'

let rememberedOn = false

type BatchArgs = {
  /** The paired desktop (or server) this sheet belongs to: it places auto starts. */
  hostClient: RpcClient | null
  /** The picked repo's own host. */
  repoClient: RpcClient | null
  selectedRepo: MobileWorkspaceRepo | null
  runtimeSettings: unknown
  agentOptions: readonly NewWorktreeAgentOption[]
  selectedAgent: NewWorktreeAgentOption
  onClose: () => void
}

function BatchBody(
  props: BatchArgs & { config: ReturnType<typeof readForkBatchStartSettingsFrom> }
) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const agents = useMemo(
    () =>
      props.agentOptions.filter(
        (option): option is NewWorktreeAgentOption & { id: TuiAgent } => option.id !== '__blank__'
      ),
    [props.agentOptions]
  )
  const labelOf = useCallback(
    (agent: TuiAgent): string => agents.find((option) => option.id === agent)?.label ?? agent,
    [agents]
  )
  const { hostClient, repoClient, selectedRepo } = props
  const setupMissing = props.config.setupMissing
  const send = useCallback(
    (prompt: string, picked: TuiAgent[], auto: boolean) => {
      const client = auto ? hostClient : repoClient
      if (!client || !selectedRepo) {
        return Promise.reject(new Error('Pick a project first.'))
      }
      const request = mobileForkBatchRequest(
        {
          project: { id: getProjectIdentityKey(selectedRepo), name: selectedRepo.displayName },
          repoId: selectedRepo.id,
          repoHostId: getRepoExecutionHostId(selectedRepo)
        },
        auto,
        prompt,
        picked,
        setupMissing
      )
      return sendMobileForkBatchStart(client, request)
    },
    [hostClient, repoClient, selectedRepo, setupMissing]
  )
  const initial = props.selectedAgent.id === '__blank__' ? agents[0]?.id : props.selectedAgent.id
  const batch = useForkBatchStart({
    config: props.config,
    initialAgents: initial ? [initial] : [],
    labelOf,
    send
  })
  const isGit = selectedRepo ? selectedRepo.kind !== 'folder' : false
  const blocked = !selectedRepo
    ? t('fork.batchStart.pickProject', 'Pick a project first.')
    : !isGit
      ? t('fork.batchStart.gitOnly', 'Batch start makes git worktrees; pick a git project.')
      : batch.agents.length === 0
        ? t('fork.batchStart.pickModel', 'Pick at least one model.')
        : null
  const atMax = batch.agents.length >= FORK_BATCH_START_MAX_AGENTS
  const autoLabel = t('fork.batchStart.autoHost', 'Auto machine')
  const keepOpenLabel = t('fork.batchStart.keepOpen', 'Keep open')
  return (
    <>
      <SectionHeader title={t('fork.batchStart.prompt', 'Prompt')} />
      <TextField
        value={batch.prompt}
        onChangeText={batch.setPrompt}
        editable={!batch.sending}
        multiline
        placeholder={t('fork.batchStart.mobilePlaceholder', 'What should the agent do?')}
      />
      <SectionHeader title={t('fork.batchStart.models', 'Models (one task each)')} />
      <ListGroup separatorInset={LIST_LEADING_INSET}>
        {agents.map((option) => {
          const picked = batch.agents.includes(option.id)
          return (
            <ListRow
              key={option.id}
              title={option.label}
              leading={<MobileAgentIcon agentId={option.id} size={20} />}
              selected={picked}
              disabled={batch.sending || (!picked && atMax)}
              accessibilityRole="checkbox"
              onPress={() => batch.toggleAgent(option.id)}
            />
          )
        })}
      </ListGroup>
      <SectionHeader title={t('fork.batchStart.options', 'Batch')} />
      <ListGroup>
        <ListRow
          title={autoLabel}
          subtitle={
            batch.auto
              ? t(
                  'fork.batchStart.mobileAutoHelp',
                  'The machine with the most spare CPU and memory'
                )
              : t('fork.batchStart.mobileHereHelp', 'The run target picked above')
          }
          accessory={
            <MobileSwitch
              accessibilityLabel={autoLabel}
              value={batch.auto}
              onValueChange={batch.setAuto}
            />
          }
        />
        <ListRow
          title={keepOpenLabel}
          accessory={
            <MobileSwitch
              accessibilityLabel={keepOpenLabel}
              value={batch.keepOpen}
              onValueChange={batch.setKeepOpen}
            />
          }
        />
      </ListGroup>
      {batch.error || blocked ? <Text style={styles.error}>{batch.error ?? blocked}</Text> : null}
      {batch.acks.length > 0 ? (
        <>
          <SectionHeader title={t('fork.batchStart.started', 'Started')} />
          <ListGroup>
            {batch.acks.map((ack) => (
              <ListRow key={ack.id} title={ack.excerpt} subtitle={ack.lines.join('\n')} />
            ))}
          </ListGroup>
        </>
      ) : null}
      <View style={styles.footer}>
        <SheetPrimaryButton
          label={t('fork.batchStart.start', 'Start')}
          busy={batch.sending}
          disabled={Boolean(blocked) || batch.sending || !batch.prompt.trim()}
          onPress={() => {
            void batch.submit(false).then((outcome) => {
              if (outcome === 'close') {
                props.onClose()
              }
            })
          }}
        />
      </View>
    </>
  )
}

/** Hook (NewWorktreeModal): the sheet's Batch switch, and the batch box while it is on. */
export function useMobileForkBatchStart(args: BatchArgs): {
  toggle: ReactNode
  body: ReactNode
} {
  const t = useMobileTranslation()
  const config = readForkBatchStartSettingsFrom(args.runtimeSettings)
  const [on, setOnState] = useState(rememberedOn)
  const setOn = useCallback((next: boolean): void => {
    rememberedOn = next
    setOnState(next)
  }, [])
  if (!config.enabled) {
    return { toggle: null, body: null }
  }
  const label = t('fork.batchStart.mobileMode', 'Batch start')
  const toggle = (
    <ListGroup>
      <ListRow
        title={label}
        subtitle={t('fork.batchStart.mobileModeHelp', 'A worktree and agent per prompt and model')}
        accessory={<MobileSwitch accessibilityLabel={label} value={on} onValueChange={setOn} />}
      />
    </ListGroup>
  )
  return { toggle, body: on ? <BatchBody {...args} config={config} /> : null }
}
