// BAD-742: `--as-service` on `orchestration send`, added to the stock spec without editing it.
import type { CommandSpec } from '../discovery/command-spec'

const NOTE =
  "--as-service (with --to bot:<name>) sends as a background service that has no terminal or chat of its own, as your owner, so no --from is needed. It is refused from inside an Orca terminal or chat, where mail carries that agent's identity."

export function withForkServiceSendFlag(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    spec.path.join(' ') === 'orchestration send'
      ? {
          ...spec,
          usage: spec.usage.replace('[--from <handle>]', '[--from <handle> | --as-service]'),
          allowedFlags: [...spec.allowedFlags, 'as-service'],
          booleanFlags: [...(spec.booleanFlags ?? []), 'as-service'],
          notes: [...(spec.notes ?? []), NOTE]
        }
      : spec
  )
}
