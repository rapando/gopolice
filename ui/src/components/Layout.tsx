import { ReactNode } from 'react'

interface LayoutProps {
  page: string
  onNavigate: (page: string, param?: string) => void
  scanning: boolean
  onScan: () => void
  children: ReactNode
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'issues', label: 'Issues' },
  { id: 'tests', label: 'Tests' },
  { id: 'security', label: 'Security' },
  { id: 'git', label: 'Git' },
  { id: 'config', label: 'Config' },
]

export default function Layout({ page, onNavigate, scanning, onScan, children }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-gray-200 flex items-center shrink-0 px-5">
        <div className="flex items-center gap-6 mr-8">
          <h1 className="font-bold text-base tracking-tight text-gray-800">gopolice</h1>
        </div>

        <nav className="flex items-center gap-1 flex-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`px-3 py-3 text-sm transition-colors border-b-2 ${
                page === item.id
                  ? 'border-blue-500 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          onClick={onScan}
          disabled={scanning}
          className="px-4 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400 rounded transition-colors text-white disabled:cursor-not-allowed"
        >
          {scanning ? 'Scanning...' : 'Run Scan'}
        </button>
      </header>

      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  )
}
