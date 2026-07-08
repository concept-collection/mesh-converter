import { useRef, useState } from 'react'
import { MeshView } from './MeshView'
import type { MeshData } from './mesh/types'
import { faceCount, vertexCount } from './mesh/types'
import { acceptedExtensions, conversionLosses, formatForFilename, formats } from './mesh/formats'
import { makeSampleMesh } from './mesh/sample'
import './App.css'

function App() {
  const [mesh, setMesh] = useState<MeshData | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [exportFormatId, setExportFormatId] = useState(formats[0].id)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const exportFormat = formats.find((f) => f.id === exportFormatId) ?? formats[0]
  const losses = mesh ? conversionLosses(mesh, exportFormat) : []

  const handleFile = async (file: File) => {
    setError(null)
    const format = formatForFilename(file.name)
    if (!format) {
      setError(
        `Unrecognized extension on "${file.name}". Supported: ${acceptedExtensions.join(', ')}`,
      )
      return
    }
    try {
      const text = await file.text()
      setMesh(format.parse(text))
      setSourceLabel(`${file.name} (${format.label})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadSample = () => {
    setError(null)
    setMesh(makeSampleMesh())
    setSourceLabel('built-in sample')
  }

  const downloadExport = () => {
    if (!mesh) return
    const text = exportFormat.serialize(mesh)
    const base = (mesh.name ?? 'mesh').replace(/[^\w-]+/g, '_').toLowerCase() || 'mesh'
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = base + exportFormat.extension
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h1>Mesh Converter</h1>
        <p className="tagline">
          Load a mesh, inspect it in 3D, export to another format. Formats differ in what they can
          store — anything the target can't hold is dropped.
        </p>

        <section>
          <h2>Load</h2>
          <div className="button-row">
            <button onClick={() => fileInputRef.current?.click()}>Open mesh file…</button>
            <button onClick={loadSample}>Load sample</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedExtensions.join(',')}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
          {error && <div className="error">{error}</div>}
        </section>

        {mesh && (
          <section>
            <h2>Loaded mesh</h2>
            <div className="mesh-info">
              <div className="source">{sourceLabel}</div>
              <div>
                <strong>{mesh.name ?? '(unnamed)'}</strong> — {vertexCount(mesh)} vertices,{' '}
                {faceCount(mesh)} faces
              </div>
              <div className="chips">
                <span className="chip on">positions</span>
                <span className="chip on">faces</span>
                <span className={`chip ${mesh.normals ? 'on' : ''}`}>normals</span>
                <span className={`chip ${mesh.colors ? 'on' : ''}`}>colors</span>
                <span className={`chip ${mesh.name ? 'on' : ''}`}>name</span>
              </div>
            </div>
          </section>
        )}

        {mesh && (
          <section>
            <h2>Export</h2>
            <select value={exportFormatId} onChange={(e) => setExportFormatId(e.target.value)}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} — {f.extension}
                </option>
              ))}
            </select>
            <p className="format-blurb">{exportFormat.blurb}</p>
            {losses.length > 0 ? (
              <div className="warning">
                Exporting to {exportFormat.extension} will drop:{' '}
                <strong>{losses.join(', ')}</strong>
              </div>
            ) : (
              <div className="ok">Lossless — this format keeps everything in the loaded mesh.</div>
            )}
            <button className="primary" onClick={downloadExport}>
              Download {exportFormat.extension}
            </button>
          </section>
        )}

        <section>
          <h2>Formats</h2>
          <table className="format-table">
            <thead>
              <tr>
                <th>Format</th>
                <th>normals</th>
                <th>colors</th>
                <th>name</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.id.toUpperCase()} <span className="ext">{f.extension}</span>
                  </td>
                  <td>{f.capabilities.normals ? '✓' : '—'}</td>
                  <td>{f.capabilities.colors ? '✓' : '—'}</td>
                  <td>{f.capabilities.name ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="footnote">
            These are invented text formats for illustration; real formats come later. All store
            positions and triangle faces.
          </p>
        </section>
      </div>

      <div className="viewport">
        {mesh ? (
          <MeshView mesh={mesh} />
        ) : (
          <div className="empty-state">
            <p>No mesh loaded.</p>
            <p>Open a .mopf, .tricol, or .bmsh file — or load the sample.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
