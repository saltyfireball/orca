// Fork (SLRM-2405): caps for the typecheck runner. Several checkouts checking at the same time each
// start their own compilers, and the runner sizes itself from the whole host.
export const TYPECHECK_JOBS_ENV = 'ORCA_FORK_TYPECHECK_JOBS'
export const TYPECHECK_CHECKERS_ENV = 'ORCA_FORK_TYPECHECK_CHECKERS'

// Only ever lowers: the runner's own limits still apply. Unset or empty leaves the value as is.
function capFromEnv(name, value, env) {
  const raw = env[name]?.trim()
  if (!raw) {
    return value
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return Math.min(value, Number(raw))
}

/** How many projects the runner checks at once, lowered to the cap in the environment. */
export function forkTypecheckParallelism(parallelism, env = process.env) {
  return capFromEnv(TYPECHECK_JOBS_ENV, parallelism, env)
}

/** Checker threads of one tsrs compiler when no --checkers flag is given: fewer hold less memory. */
export function forkTypecheckCheckers(checkers, env = process.env) {
  return capFromEnv(TYPECHECK_CHECKERS_ENV, checkers, env)
}
