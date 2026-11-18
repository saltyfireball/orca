// SLRM-2390 (FORK.md "Row status"): one chat's estimated spend for its agent rows, priced like the
// usage report (SLRM-2104) prices it. A subscription chat is priced too: the row says what its
// tokens would cost per token, and its tooltip says it is a subscription.
import type { ForkCacheState } from '../../../shared/fork/usage-ledger'
import { totalTokens, type UsageChatRecord } from './usage-ledger-model'
import type { UsagePricer } from './usage-report'

export type ChatSpend = Pick<ForkCacheState, 'costUsd' | 'unpriced'>

/** The chat's cost over every day the ledger still keeps; absent when no call has a price. */
export function chatSpend(chat: UsageChatRecord, pricer: UsagePricer): ChatSpend {
  let costUsd: number | undefined
  let unpriced = false
  for (const models of Object.values(chat.days)) {
    for (const [model, cell] of Object.entries(models)) {
      const cost = pricer(model, cell.tokens)
      if (cost === null) {
        unpriced ||= totalTokens(cell.tokens) > 0
      } else {
        costUsd = (costUsd ?? 0) + cost
      }
    }
  }
  return {
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(unpriced ? { unpriced: true } : {})
  }
}
