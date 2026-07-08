import { useEffect, useRef, useState } from 'react'
import { MeshView } from './MeshView'
import type { MeshData } from './mesh/types'
import { faceCount, vertexCount } from './mesh/types'
import { acceptedExtensions, conversionLosses, formatForFilename, formats } from './mesh/formats'
import {
  estimateExportSize,
  getMeshioVersion,
  initMeshio,
  parseMeshFile,
  serializeMesh,
} from './mesh/meshio'
import { makeSampleMesh } from './mesh/sample'
import './App.css'

type EngineState = 'loading' | 'ready' | 'error'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function App() {
  const [mesh, setMesh] = useState<MeshData | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string>('')
  const [baseName, setBaseName] = useState<string>('mesh')
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exportFormatId, setExportFormatId] = useState(formats[0].id)
  const [engine, setEngine] = useState<{ state: EngineState; message: string }>({
    state: 'loading',
    message: 'Loading mesh engine…',
  })
  const [busy, setBusy] = useState<'parsing' | 'exporting' | 'sizing' | null>(null)
  const [exportSizes, setExportSizes] = useState<Record<string, number> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const exportFormat = formats.find((f) => f.id === exportFormatId) ?? formats[0]
  const losses = mesh ? conversionLosses(mesh, exportFormat) : []
  const engineReady = engine.state === 'ready'

  useEffect(() => {
    let cancelled = false
    initMeshio((message) => {
      if (!cancelled) setEngine({ state: 'loading', message })
    })
      .then(() => getMeshioVersion())
      .then((version) => {
        if (!cancelled) setEngine({ state: 'ready', message: `meshio ${version} ready` })
      })
      .catch((e) => {
        if (!cancelled) {
          setEngine({
            state: 'error',
            message: `Mesh engine failed to load: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleFile = async (file: File) => {
    setError(null)
    const format = formatForFilename(file.name)
    if (!format) {
      setError(
        `Unrecognized extension on "${file.name}". Supported: ${acceptedExtensions.join(', ')}`,
      )
      return
    }
    setBusy('parsing')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { mesh: parsed, info } = await parseMeshFile(bytes, format)
      setMesh(parsed)
      setExportSizes(null)
      setParseWarnings(info.warnings)
      setSourceLabel(`${file.name} (${format.label})`)
      setBaseName(file.name.replace(/\.[^.]+$/, ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const loadSample = () => {
    setError(null)
    setMesh(makeSampleMesh())
    setExportSizes(null)
    setParseWarnings([])
    setSourceLabel('built-in sample')
    setBaseName('rainbow_torus')
  }

  const estimateSizes = async () => {
    if (!mesh) return
    setError(null)
    setBusy('sizing')
    setExportSizes({})
    try {
      // pure-Python formats first, so a first-time h5py download doesn't
      // hold up the quick results
      const ordered = [...formats].sort(
        (a, b) => (a.pyodidePackages?.length ?? 0) - (b.pyodidePackages?.length ?? 0),
      )
      for (const format of ordered) {
        const size = await estimateExportSize(mesh, format)
        setExportSizes((prev) => ({ ...(prev ?? {}), [format.id]: size }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const downloadExport = async () => {
    if (!mesh) return
    setError(null)
    setBusy('exporting')
    try {
      const bytes = await serializeMesh(mesh, exportFormat)
      const base = baseName.replace(/[^\w-]+/g, '_').toLowerCase() || 'mesh'
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = base + exportFormat.extension
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h1>Mesh Converter</h1>
        <p className="tagline">
          Load a mesh, inspect it in 3D, export to another format. Conversion runs entirely in
          your browser via <a href="https://github.com/nschloe/meshio">meshio</a> on Pyodide.
        </p>
        <div className={`engine-status ${engine.state}`}>{engine.message}</div>

        <section>
          <h2>Load</h2>
          <div className="button-row">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!engineReady || busy !== null}
            >
              {busy === 'parsing' ? 'Reading…' : 'Open mesh file…'}
            </button>
            <button onClick={loadSample} disabled={busy !== null}>
              Load sample
            </button>
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
                {vertexCount(mesh)} vertices, {faceCount(mesh)} faces
              </div>
              <div className="chips">
                <span className="chip on">positions</span>
                <span className="chip on">faces</span>
                <span className={`chip ${mesh.normals ? 'on' : ''}`}>normals</span>
                <span className={`chip ${mesh.colors ? 'on' : ''}`}>colors</span>
              </div>
              {parseWarnings.length > 0 && (
                <p className="footnote">{parseWarnings.join('; ')}</p>
              )}
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
                  {exportSizes?.[f.id] != null ? ` (${formatBytes(exportSizes[f.id])})` : ''}
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
            <button
              className="primary"
              onClick={downloadExport}
              disabled={!engineReady || busy !== null}
            >
              {busy === 'exporting' ? 'Converting…' : `Download ${exportFormat.extension}`}
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
                {exportSizes && <th>size</th>}
              </tr>
            </thead>
            <tbody>
              {formats.map((f) => (
                <tr
                  key={f.id}
                  className={f.id === exportFormatId ? 'selected' : ''}
                  onClick={() => setExportFormatId(f.id)}
                  title={`Export as ${f.label}`}
                >
                  <td>
                    {f.id.toUpperCase()} <span className="ext">{f.extension}</span>
                  </td>
                  <td>{f.capabilities.normals ? '✓' : '—'}</td>
                  <td>{f.capabilities.colors ? '✓' : '—'}</td>
                  {exportSizes && (
                    <td className="size">
                      {exportSizes[f.id] != null ? formatBytes(exportSizes[f.id]) : '…'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {mesh && (
            <button
              className="subtle"
              onClick={estimateSizes}
              disabled={!engineReady || busy !== null}
            >
              {busy === 'sizing' ? 'Estimating sizes…' : 'Estimate export sizes for this mesh'}
            </button>
          )}
          <p className="footnote">
            All formats store positions and triangle faces; ✓ marks the extra attributes this app
            preserves on export. Quads and polygons are triangulated on import. Click a row to
            choose the export format.
          </p>
        </section>
      </div>

      <div className="viewport">
        {mesh ? (
          <MeshView mesh={mesh} />
        ) : (
          <div className="empty-state">
            <p>No mesh loaded.</p>
            <p>Open a {acceptedExtensions.join(', ')} file — or load the sample.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
