// "Open in editor" links. The scan result holds project-relative paths; the
// server reports the absolute project directory so we can build editor URLs.

export type Editor = 'vscode' | 'cursor' | 'goland' | 'zed' | 'none'

export const editors: { id: Editor; label: string }[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'goland', label: 'GoLand' },
  { id: 'zed', label: 'Zed' },
  { id: 'none', label: 'Off' },
]

const KEY = 'gopolice-editor'
let projectDir = ''

export function setProjectDir(dir: string) {
  projectDir = dir.replace(/\/+$/, '')
}

export function getEditor(): Editor {
  try {
    const v = localStorage.getItem(KEY) as Editor | null
    if (v && editors.some((e) => e.id === v)) return v
  } catch {
    // storage unavailable
  }
  return 'vscode'
}

export function setEditor(e: Editor) {
  try {
    localStorage.setItem(KEY, e)
  } catch {
    // ignore
  }
}

/** Returns a URL that opens file:line in the chosen editor, or null if unavailable. */
export function editorURL(file: string, line?: number): string | null {
  const editor = getEditor()
  if (editor === 'none' || !projectDir || !file) return null
  const abs = file.startsWith('/') ? file : `${projectDir}/${file}`
  const ln = line && line > 0 ? line : 1
  switch (editor) {
    case 'vscode': return `vscode://file${encodeURI(abs)}:${ln}`
    case 'cursor': return `cursor://file${encodeURI(abs)}:${ln}`
    case 'zed': return `zed://file${encodeURI(abs)}:${ln}`
    case 'goland': return `goland://open?file=${encodeURIComponent(abs)}&line=${ln}`
  }
  return null
}

/** "path/to/file.go:42" — the form editors and terminals accept for jump-to-line. */
export function fileLocation(file: string, line?: number): string {
  return line && line > 0 ? `${file}:${line}` : file
}
