interface EmptyStateProps {
  message: string
  onScan?: () => void
  scanning?: boolean
}

// Shared "no data yet" card — used wherever a page can have no results, so the
// "run a scan to populate this" affordance is consistent across the app.
export default function EmptyState({ message, onScan, scanning }: EmptyStateProps) {
  return (
    <div className="card p-10 text-center">
      <p className="text-gray-500 dark:text-ctp-subtext0 mb-4">{message}</p>
      {onScan && (
        <button
          onClick={onScan}
          disabled={scanning}
          className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {scanning ? 'Scanning...' : 'Run Scan'}
        </button>
      )}
    </div>
  )
}
