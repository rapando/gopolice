import { useState, useEffect } from 'react'
import { getConfig } from '../api/client'

export default function ConfigPage() {
  const [config, setConfig] = useState<any>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    getConfig().then((c) => {
      setConfig(c)
      setText(JSON.stringify(c, null, 2))
    }).catch(() => {})
  }, [])

  if (!config) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h2 className="text-lg font-bold text-gray-800 mb-5">Config</h2>
        <div className="card p-8 text-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-800">Config</h2>
        <button
          onClick={() => setEditing(!editing)}
          className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
        >
          {editing ? 'View' : 'Edit'}
        </button>
      </div>

      <div className="card">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-96 font-mono text-sm p-4 bg-transparent border-0 focus:outline-none resize-none text-gray-800"
          />
        ) : (
          <pre className="font-mono text-sm p-5 overflow-auto max-h-[70vh] text-gray-700 leading-relaxed">
            {JSON.stringify(config, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
