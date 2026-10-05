import { LoaderCircle } from 'lucide-react'

interface SpinnerProps {
  size?: number
  className?: string
}

export default function Spinner({ size = 6, className = '' }: SpinnerProps) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Loading"
      className={`animate-spin text-accent ${className}`}
      style={{ height: `${size * 4}px`, width: `${size * 4}px` }}
    />
  )
}
