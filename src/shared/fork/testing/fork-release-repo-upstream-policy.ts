// Upstream updater tests exercise every upstream channel and repo. They mock fork-release-repo with
// these overrides so they keep covering upstream code, while fork-release-repo.test.ts covers the
// fork policy. No import of fork-release-repo here: under the mock it would resolve to itself.

export function isForkReleaseChannel(_channel: string): boolean {
  return true
}

export function forkReleaseRepoForChannel(_channel: string, upstreamRepo: string): string {
  return upstreamRepo
}

export function assertForkReleaseRepo(repo: string): string {
  return repo
}
