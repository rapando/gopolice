import { FormEvent, useState } from 'react'
import { Fingerprint, LoaderCircle, ShieldCheck } from 'lucide-react'
import {
  loginWithPassword, loginWithTouchId, passkeyBegin, passkeyFinishLogin, setupAccount, type SessionInfo,
} from '../api/client'
import { getPasskey, passkeysSupported, wasCancelled } from '../lib/passkey'

interface Props {
  session: SessionInfo
  onAuthenticated: (s: SessionInfo) => void
}

export default function Login({ session, onAuthenticated }: Props) {
  const setup = session.setup_required
  const osMode = !!session.os_mode
  const [username, setUsername] = useState(session.os_username ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (setup && password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const s = setup
        ? await setupAccount(username, password, token)
        : await loginWithPassword(username, password)
      onAuthenticated(s)
    } catch (err: any) {
      setError(err.message ?? String(err))
      setBusy(false)
    }
  }

  const withPasskey = async () => {
    setError('')
    setBusy(true)
    try {
      const { ceremony, options } = await passkeyBegin('login')
      const credential = await getPasskey(options)
      onAuthenticated(await passkeyFinishLogin(ceremony, credential))
    } catch (err: any) {
      if (!wasCancelled(err)) setError(err.message ?? String(err))
      setBusy(false)
    }
  }

  const withTouchId = async () => {
    setError('')
    setBusy(true)
    try {
      onAuthenticated(await loginWithTouchId())
    } catch (err: any) {
      setError(err.message ?? String(err))
      setBusy(false)
    }
  }

  const canPasskey = !osMode && !setup && passkeysSupported()
  const canTouchId = osMode && !!session.touch_id

  return (
    <div className="min-h-screen bg-canvas text-fg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <ShieldCheck className="w-6 h-6 text-accent" aria-hidden="true" />
          <span className="font-mono font-semibold text-lg tracking-tight">gopolice</span>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold">{setup ? 'Create your account' : 'Sign in'}</h1>
          <p className="text-sm text-fg-muted mt-1">
            {setup
              ? 'This account protects access to your repositories. You can add a passkey for Touch ID afterwards.'
              : osMode
                ? <>Sign in with the macOS account <span className="font-mono">{session.os_username}</span> to open repositories and run scans.</>
                : 'Sign in to open repositories and run scans.'}
          </p>

          {canTouchId && (
            <>
              <button onClick={withTouchId} disabled={busy} className="btn-primary w-full mt-5 py-2">
                <Fingerprint className="w-4 h-4" aria-hidden="true" />
                Sign in with Touch ID
              </button>
              <p className="text-xs text-fg-muted mt-2">A system prompt appears on this Mac.</p>
              <div className="flex items-center gap-3 my-5 text-xs text-fg-subtle">
                <span className="flex-1 border-t border-line" />
                or use your Mac password
                <span className="flex-1 border-t border-line" />
              </div>
            </>
          )}

          {canPasskey && (
            <>
              <button onClick={withPasskey} disabled={busy} className="btn-primary w-full mt-5 py-2">
                <Fingerprint className="w-4 h-4" aria-hidden="true" />
                Sign in with passkey
              </button>
              <div className="flex items-center gap-3 my-5 text-xs text-fg-subtle">
                <span className="flex-1 border-t border-line" />
                or use your password
                <span className="flex-1 border-t border-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={`space-y-4 ${canPasskey || canTouchId ? '' : 'mt-5'}`}>
            <Field label={osMode ? 'macOS username' : 'Username'}>
              <input
                className="input w-full"
                autoComplete="username"
                autoFocus={!canTouchId}
                required
                readOnly={osMode}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label={osMode ? 'macOS password' : 'Password'} hint={setup ? 'At least 8 characters.' : undefined}>
              <input
                className="input w-full"
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
                minLength={setup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {setup && (
              <Field label="Confirm password">
                <input
                  className="input w-full"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            )}
            {setup && session.setup_token_required && (
              <Field label="Setup token" hint="Printed in the terminal where the service was started.">
                <input
                  className="input w-full font-mono"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Field>
            )}

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            <button type="submit" disabled={busy} className="btn-secondary w-full py-2">
              {busy && <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {setup ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-fg-muted mt-1">{hint}</span>}
    </label>
  )
}
