// Digest (SLRM-2388, FORK.md): the phone's typed read of fork.digest.collect. The host answers for
// itself and its paired servers; the shared schema checks the reply before the screen shows it.
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import { ForkDigestSchema } from '../../../../../src/shared/fork/digest-schema'

export const forkDigestRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'fork.digest.mobile-collect',
    method: 'fork.digest.collect',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('fork-digest', ForkDigestSchema)
  })
)
