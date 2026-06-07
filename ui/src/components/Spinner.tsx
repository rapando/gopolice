interface SpinnerProps {
  size?: number
  className?: string
}

export default function Spinner({ size = 6, className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 border-blue-500 dark:border-ctp-blue border-t-transparent ${className}`}
      style={{ height: `${size * 4}px`, width: `${size * 4}px` }}
    />
  )
}
