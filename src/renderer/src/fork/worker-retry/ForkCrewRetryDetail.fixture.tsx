import { defineFixture } from '../../component-fixtures/component-fixture'
import type { OrchestrationCrewRow } from '../../../../shared/orchestration/orchestration-crew'
import { CrewRowDetails } from '../../components/orchestration-crew/CrewRowDetails'

const row = (
  title: string,
  forkRetry: OrchestrationCrewRow['forkRetry']
): OrchestrationCrewRow => ({
  partyKey: title,
  role: 'worker',
  label: title,
  agentKind: 'claude',
  status: 'done',
  task: { title, state: 'ready' },
  forkRetry
})

// BAD-681: the crew row details of workers in each retry state.
export const states = defineFixture({
  width: 420,
  render: () => (
    <div className="flex flex-col gap-3 p-3">
      <CrewRowDetails
        row={row('Port the importer', {
          attempt: 1,
          reason: 'the worker process exited',
          state: 'waiting',
          side: 'ended',
          dueAt: new Date(Date.now() + 30_000).toISOString()
        })}
      />
      <CrewRowDetails
        row={row('Port the importer', {
          attempt: 1,
          reason: 'the worker process exited',
          state: 'restarted',
          side: 'ended'
        })}
      />
      <CrewRowDetails
        row={row('Port the importer, retry 1', {
          attempt: 1,
          reason: 'the worker process exited',
          state: 'restarted',
          side: 'restart'
        })}
      />
      <CrewRowDetails
        row={row('Port the importer, retry 2', {
          attempt: 2,
          reason: 'the agent hit a provider error',
          state: 'gave-up',
          side: 'ended',
          detail: 'the limit was reached'
        })}
      />
    </div>
  )
})
