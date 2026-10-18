import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { Check, Fingerprint, Trash2 } from 'lucide-react'
import {
  changePassword, deletePasskey, listPasskeys, passkeyBegin, passkeyFinishRegister, type Passkey,
} from '../api/client'
import { createPasskey, passkeysSupported, wasCancelled } from '../lib/passkey'

export default function Account({ osUsername }: { osUsername?: string }) {
  if (osUsername) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <Section title="Account" desc="Sign-in is handled by macOS.">
          <p className="text-sm">
            You are signed in as the macOS user <span className="font-mono">{osUsername}</span>. Your password and
            Touch ID are managed in System Settings; gopolice stores no credentials of its own.
          </p>
        </Section>
      </div>
    )
  }
  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <PasskeySection />
      <PasswordSection />
    </div>
  )
}

function PasskeySection() {
  const [keys, setKeys] = useState<Passkey[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = passkeysSupported()

  useEffect(() => {
    listPasskeys().then(setKeys).catch((e) => setError(e.message ?? String(e)))
  }, [])

  const add = async () => {
    setError('')
    setBusy(true)
    try {
      const { ceremony, options } = await passkeyBegin('register')
      const credential = await createPasskey(options)
      setKeys(await passkeyFinishRegister(ceremony, name || defaultName(), credential))
      setName('')
    } catch (e: any) {
      if (!wasCancelled(e)) setError(e.message ?? String(e))
    }
    setBusy(false)
  }

  const remove = async (id: string) => {
    try {
      setKeys(await deletePasskey(id))
    } catch (e: any) {
      setError(e.message ?? String(e))
    }
  }

  return (
    <Section
      title="Passkeys"
      desc="Sign in with Touch ID, Windows Hello or your device PIN instead of typing a password."
    >
      {!supported && (
        <p className="text-sm text-warning">
          Passkeys need a secure connection: open gopolice at <code className="font-mono text-xs">http://localhost</code> or over HTTPS.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {keys && keys.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-md">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-4 py-3">
              <Fingerprint className="w-4 h-4 text-fg-subtle shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{k.name}</p>
                <p className="text-xs text-fg-muted">
                  Added {new Date(k.added_at).toLocaleDateString()}
                  {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}
                </p>
              </div>
              <button onClick={() => remove(k.id)} className="btn-ghost" title="Remove passkey">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Remove {k.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          placeholder={`Name, e.g. ${defaultName()}`}
          aria-label="Passkey name"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={add} disabled={busy || !supported} className="btn-primary">
          <Fingerprint className="w-4 h-4" aria-hidden="true" />
          Add passkey
        </button>
      </div>
    </Section>
  )
}

function defaultName(): string {
  const p = navigator.platform || ''
  if (/mac/i.test(p)) return 'Mac'
  if (/win/i.test(p)) return 'Windows PC'
  if (/linux/i.test(p)) return 'Linux'
  return 'This device'
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setDone(false)
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      setDone(true)
    } catch (err: any) {
      setError(err.message ?? String(err))
    }
    setBusy(false)
  }

  return (
    <Section title="Password" desc="Changing it signs out every other session.">
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <label className="block">
          <span className="block text-sm font-medium mb-1">Current password</span>
          <input className="input w-full" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">New password</span>
          <input className="input w-full" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Confirm new password</span>
          <input className="input w-full" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">Change password</button>
          {done && (
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <Check className="w-4 h-4" aria-hidden="true" /> Changed
            </span>
          )}
        </div>
      </form>
    </Section>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card">
      <header className="px-6 py-4 border-b border-line">
        <h2 className="text-base font-semibold">{title}</h2>
        {desc && <p className="text-sm text-fg-muted mt-0.5">{desc}</p>}
      </header>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </section>
  )
}
