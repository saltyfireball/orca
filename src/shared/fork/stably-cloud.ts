// Upstream cloud services switch (BAD-896, FORK.md "One switch for upstream's cloud services"):
// every hosted service that belongs to the upstream project (sign-in, phone relay, push gateway,
// connector, share links, what's-new feeds, plugin stats and kill list) answers to this one value.
// Self-contained so the renderer and the main process share it.

export type ForkStablyCloudSettings = {
  /** Fork (BAD-896): true calls upstream's hosted services, false calls none; unset follows the build default (off unless the build says on). */
  forkStablyCloudEnabled?: boolean
}

export const FORK_STABLY_CLOUD_OFF_MESSAGE =
  'Upstream cloud services are off in this build (forkStablyCloudEnabled).'

declare const ORCA_FORK_STABLY_CLOUD_DEFAULT: boolean | undefined

/** What an unset setting means: the build's compiled-in default, off when the build set none. */
export function forkStablyCloudBuildDefault(): boolean {
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- undeclared outside electron-vite builds; a bare read throws.
  const defined = typeof ORCA_FORK_STABLY_CLOUD_DEFAULT !== 'undefined'
  return defined && ORCA_FORK_STABLY_CLOUD_DEFAULT === true
}

export function forkStablyCloudEnabled(
  settings: unknown,
  buildDefault: boolean = forkStablyCloudBuildDefault()
): boolean {
  const value: unknown =
    typeof settings === 'object' && settings !== null
      ? Reflect.get(settings, 'forkStablyCloudEnabled')
      : undefined
  return typeof value === 'boolean' ? value : buildDefault
}
