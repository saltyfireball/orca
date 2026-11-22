// BAD-737 (FORK.md "Owner token"): mint, rotate and revoke the token that lets a tool outside Orca,
// such as an MCP server, answer a bot's items as you. The token shows here once, after a mint.
import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  FORK_OWNER_TOKEN_ENV,
  FORK_OWNER_TOKEN_MINT_METHOD,
  FORK_OWNER_TOKEN_REVOKE_METHOD,
  FORK_OWNER_TOKEN_STATUS_METHOD,
  type ForkOwnerTokenMintResult,
  type ForkOwnerTokenStatus
} from '../../../../shared/fork/owner-token'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'

const LOCAL = { kind: 'local' } as const
const CALL_TIMEOUT_MS = 15_000

export function ForkOwnerTokenSetting(): React.JSX.Element {
  const t = useTranslate()
  const [status, setStatus] = useState<ForkOwnerTokenStatus | null>(null)
  const [minted, setMinted] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = useCallback(async <T,>(method: string): Promise<T> => {
    return callRuntimeRpc<T>(LOCAL, method, {}, { timeoutMs: CALL_TIMEOUT_MS })
  }, [])

  const refresh = useCallback(async () => {
    try {
      setStatus(await call<ForkOwnerTokenStatus>(FORK_OWNER_TOKEN_STATUS_METHOD))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [call])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = async (method: string): Promise<void> => {
    setBusy(true)
    setCopied(false)
    try {
      if (method === FORK_OWNER_TOKEN_MINT_METHOD) {
        setMinted((await call<ForkOwnerTokenMintResult>(method)).token)
      } else {
        await call(method)
        setMinted(null)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
    await refresh()
    setBusy(false)
  }

  const copy = async (): Promise<void> => {
    if (minted) {
      await window.api.ui.writeClipboardText(minted)
      setCopied(true)
    }
  }

  const exists = status?.exists === true
  const since =
    exists && status?.createdAt
      ? t('fork.ownerToken.since', 'A token exists, minted {{when}}.', {
          when: new Date(status.createdAt).toLocaleString()
        })
      : t('fork.ownerToken.none', 'No token exists. Nothing outside Orca can answer as you.')

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.ownerToken.title', 'Owner token')}
        description={t(
          'fork.ownerToken.description',
          'Lets a tool you run outside Orca, such as an MCP server, answer or comment on a bot item as you with `orca bot item answer`. It allows nothing else, and each answer says it came by owner token. Keep it like a password: give it to that tool only, in a file only you can read or in {{env}}.',
          { env: FORK_OWNER_TOKEN_ENV }
        )}
      />
      <SettingsRow
        label={t('fork.ownerToken.state', 'Token')}
        description={error ?? since}
        control={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(FORK_OWNER_TOKEN_MINT_METHOD)}
            >
              {exists
                ? t('fork.ownerToken.rotate', 'Replace')
                : t('fork.ownerToken.mint', 'Create token')}
            </Button>
            {exists ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(FORK_OWNER_TOKEN_REVOKE_METHOD)}
              >
                {t('fork.ownerToken.revoke', 'Revoke')}
              </Button>
            ) : null}
          </div>
        }
      />
      {minted ? (
        <SettingsRow
          label={t('fork.ownerToken.new', 'New token')}
          description={t(
            'fork.ownerToken.once',
            'Shown this once. Copy it to the tool now; any earlier token no longer works.'
          )}
          control={
            <div className="flex items-center gap-2">
              <code className="max-w-64 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                {minted}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? t('fork.ownerToken.copied', 'Copied') : t('fork.ownerToken.copy', 'Copy')}
              </Button>
            </div>
          }
        />
      ) : null}
    </section>
  )
}
