import { useState } from 'react'
import { ChevronDown, GitMerge } from 'lucide-react'
import { GitInfo, type CommitInfo } from '../api/client'
import EmptyState from '../components/EmptyState'
import StatTile from '../components/StatTile'

interface Props {
  gitInfo: GitInfo | null
  onScan?: () => void
  scanning?: boolean
}

/**
 * git's %G? codes. A badge only appears when it says something: a verified
 * signature, or a signature that is wrong. Unsigned commits (the common
 * case) and signatures whose key isn't available locally get no badge; the
 * tile above the list carries those counts instead.
 */
function signatureBadge(v: string) {
  switch (v) {
    case 'G':
      return <span className="text-xs font-medium text-success bg-success-soft px-1.5 py-0.5 rounded">Verified</span>
    case 'U':
      return <span className="text-xs font-medium text-warning bg-warning-soft px-1.5 py-0.5 rounded">Untrusted key</span>
    case 'B':
    case 'X':
    case 'Y':
    case 'R':
      return <span className="text-xs font-medium text-danger bg-danger-soft px-1.5 py-0.5 rounded">{v === 'B' ? 'Bad signature' : v === 'R' ? 'Revoked key' : 'Expired'}</span>
    default:
      return null
  }
}

const SIGNED = new Set(['G', 'U', 'B', 'X', 'Y', 'R', 'E'])

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Splits "Merge pull request #19 from x" into a merge chip and the rest. */
function describeMessage(message: string): { merge: boolean; text: string } {
  const pr = /^Merge pull request (#\d+ from .+)$/i.exec(message)
  if (pr) return { merge: true, text: pr[1] }
  const br = /^Merge (?:remote-tracking )?branch '([^']+)'(.*)$/i.exec(message)
  if (br) return { merge: true, text: `${br[1]}${br[2]}` }
  return { merge: false, text: message }
}

export default function GitStats({ gitInfo, onScan, scanning }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  if (!gitInfo) {
    return (
      <div className="page">
        <EmptyState message="No git info available." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  const commits = gitInfo.commits ?? []
  const signed = commits.filter((c) => SIGNED.has(c.verified)).length
  const verified = commits.filter((c) => c.verified === 'G').length
  const unverifiable = commits.filter((c) => c.verified === 'E').length
  const authorNames = (gitInfo.authors ?? []).map((a) => a.name)

  const toggle = (i: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  return (
    <div className="page">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatTile label="Branch" value={<span className="font-mono">{gitInfo.branch}</span>} dense title={gitInfo.branch} />
        <StatTile label="Commit" value={<span className="font-mono">{gitInfo.commit.slice(0, 7)}</span>} dense sub={gitInfo.commit_time ? `committed ${timeAgo(gitInfo.commit_time)}` : undefined} title={gitInfo.commit} />
        <StatTile
          label="Signed commits"
          value={<>{signed}<span className="text-base text-fg-subtle font-normal"> / {commits.length}</span></>}
          sub={signed === 0 ? 'none of the last commits are signed' : unverifiable > 0 ? `${verified} verified · ${unverifiable} signed with a key not available here` : `${verified} verified`}
          tone={signed === 0 ? 'muted' : verified === signed ? 'success' : 'default'}
        />
        <StatTile
          label="Authors"
          value={gitInfo.author_count}
          sub={authorNames.join(', ')}
          title={(gitInfo.authors ?? []).map((a) => `${a.name} <${a.email}> · ${a.count} commit${a.count === 1 ? '' : 's'}`).join('\n')}
        />
      </div>

      {commits.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-sm font-medium text-fg-muted">Last {commits.length} commits</p>
          </div>
          <ul className="divide-y divide-line">
            {commits.map((c, i) => (
              <CommitRow key={c.hash} commit={c} open={expanded.has(i)} onToggle={() => toggle(i)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function CommitRow({ commit: c, open, onToggle }: { commit: CommitInfo; open: boolean; onToggle: () => void }) {
  const { merge, text } = describeMessage(c.message)
  const badge = signatureBadge(c.verified)
  const when = new Date(c.date)
  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-subtle transition-colors"
      >
        <span className="font-mono text-[13px] text-fg shrink-0 w-[7ch]">{c.hash.slice(0, 7)}</span>
        {merge && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-violet bg-violet-soft px-1.5 py-0.5 rounded shrink-0">
            <GitMerge className="w-3 h-3" aria-hidden="true" /> merge
          </span>
        )}
        <span className="text-sm text-fg font-medium truncate flex-1" title={c.message}>{text}</span>
        <span className="text-xs text-fg-muted truncate max-w-[18ch] shrink-0" title={`${c.author} <${c.email}>`}>{c.author}</span>
        {badge}
        <span className="text-xs text-fg-subtle tabular-nums shrink-0 w-[9ch] text-right" title={when.toLocaleString()}>{timeAgo(c.date)}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-fg-subtle shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-5 py-3 bg-subtle border-t border-line">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-xs font-mono">
            <dt className="text-fg-subtle">Hash</dt><dd className="text-fg-muted break-all">{c.hash}</dd>
            <dt className="text-fg-subtle">Author</dt><dd className="text-fg-muted">{c.author} &lt;{c.email}&gt;</dd>
            <dt className="text-fg-subtle">Date</dt><dd className="text-fg-muted">{when.toLocaleString()}</dd>
            <dt className="text-fg-subtle">Signature</dt><dd className="text-fg-muted">{describeSignature(c.verified)}</dd>
            <dt className="text-fg-subtle">Message</dt><dd className="text-fg-muted whitespace-pre-wrap">{c.message}</dd>
          </dl>
        </div>
      )}
    </li>
  )
}

function describeSignature(v: string): string {
  switch (v) {
    case 'G': return 'good, verified'
    case 'U': return 'good, but the key is untrusted'
    case 'E': return 'signed, but the key is not available to verify it'
    case 'B': return 'bad signature'
    case 'X': return 'good, key expired'
    case 'Y': return 'good, signature expired'
    case 'R': return 'good, key revoked'
    default: return 'not signed'
  }
}
