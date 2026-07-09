import { useEffect, useRef, useState } from 'react'
import { MeshView } from './MeshView'
import { VIEW_MODES } from './viewModes'
import type { ViewMode } from './viewModes'
import type { MeshData } from './mesh/types'
import { faceCount, vertexCount } from './mesh/types'
import { acceptedExtensions, conversionLosses, formatForFilename, formats } from './mesh/formats'
import type { MeshFormat } from './mesh/formats'
import {
  convertMesh,
  estimateConvertSize,
  estimateExportSize,
  getMeshioVersion,
  initMeshio,
  parseMeshFile,
  serializeMesh,
} from './mesh/meshio'
import { makeSampleMesh } from './mesh/sample'
import { buildShareUrl, MAX_SHARE_URL_CHARS, parseShareHash } from './share'
import './App.css'

type EngineState = 'loading' | 'ready' | 'error'

/**
 * The mesh's source of truth, kept in its original native form. Export and
 * share both read from this rather than from the viewer's common `MeshData`,
 * so a conversion loses only what the target format cannot express — and a
 * same-format export returns the original bytes verbatim.
 *
 * `file` is an uploaded or shared file, byte-for-byte in its original format.
 * `sample` is the built-in mesh, generated directly as `MeshData` (its own
 * lossless ground truth), so it has no native bytes to keep.
 */
type MeshSource =
  | { kind: 'file'; formatId: string; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'sample' }

type ShareStatus =
  | { kind: 'copied'; chars: number }
  | { kind: 'manual'; url: string } // clipboard unavailable — show the link for hand-copying
  | { kind: 'too-large'; chars: number }
  | { kind: 'error'; message: string }

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
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [anaglyph, setAnaglyph] = useState(false)
  const [source, setSource] = useState<MeshSource | null>(null)
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shareLoadAttempted = useRef(false)

  const exportFormat = formats.find((f) => f.id === exportFormatId) ?? formats[0]
  const sourceFormat =
    source?.kind === 'file' ? (formats.find((f) => f.id === source.formatId) ?? null) : null
  // A same-format export of an uploaded file is the original bytes, untouched.
  const identicalToSource = source?.kind === 'file' && source.formatId === exportFormat.id
  const losses = mesh && !identicalToSource ? conversionLosses(mesh, exportFormat) : []
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

  // Load a mesh from a #share=… link on startup (parseMeshFile waits for the
  // engine init kicked off above).
  useEffect(() => {
    if (shareLoadAttempted.current) return
    shareLoadAttempted.current = true
    ;(async () => {
      let payload
      try {
        payload = await parseShareHash(window.location.hash)
      } catch (e) {
        setError(`Could not read the share link: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      if (!payload) return
      if (formats.some((f) => f.id === payload.exportFormatId)) {
        setExportFormatId(payload.exportFormatId)
      }
      if (VIEW_MODES.some((m) => m.id === payload.viewMode)) {
        setViewMode(payload.viewMode as ViewMode)
      }
      setAnaglyph(payload.anaglyph)
      if (payload.formatId === null) {
        setMesh(makeSampleMesh())
        setSource({ kind: 'sample' })
        setParseWarnings([])
        setSourceLabel('built-in sample (from share link)')
        setBaseName(payload.name || 'rainbow_torus')
        return
      }
      const format = formats.find((f) => f.id === payload.formatId)
      if (!format) {
        setError(`Could not read the share link: unknown mesh format "${payload.formatId}"`)
        return
      }
      setBusy('parsing')
      try {
        const { mesh: parsed, info } = await parseMeshFile(payload.bytes, format)
        setMesh(parsed)
        setSource({ kind: 'file', formatId: format.id, bytes: payload.bytes })
        setParseWarnings(info.warnings)
        setSourceLabel(`${payload.name}${format.extension} (${format.label}, from share link)`)
        setBaseName(payload.name || 'mesh')
      } catch (e) {
        setError(
          `Could not load the shared mesh: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        setBusy(null)
      }
    })()
  }, [])

  // A share link only describes the mesh it was created for — drop it from
  // the address bar once a different mesh is loaded.
  const clearShareHash = () => {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }

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
      setSource({ kind: 'file', formatId: format.id, bytes })
      setShareStatus(null)
      clearShareHash()
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
    setSource({ kind: 'sample' })
    setShareStatus(null)
    clearShareHash()
  }

  const shareMesh = async () => {
    if (!source) return
    setShareStatus(null)
    try {
      const url = await buildShareUrl({
        name: baseName,
        formatId: source.kind === 'file' ? source.formatId : null,
        exportFormatId,
        viewMode,
        anaglyph,
        bytes: source.kind === 'file' ? source.bytes : new Uint8Array(0),
      })
      if (url.length > MAX_SHARE_URL_CHARS) {
        setShareStatus({ kind: 'too-large', chars: url.length })
        return
      }
      try {
        await navigator.clipboard.writeText(url)
        setShareStatus({ kind: 'copied', chars: url.length })
      } catch {
        setShareStatus({ kind: 'manual', url })
      }
    } catch (e) {
      setShareStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // Size of the mesh exported to `format`, taken from the native source: the
  // original bytes when it matches, meshio conversion otherwise; the sample
  // has no native file, so it serializes from its common-form MeshData.
  const exportSizeFor = async (format: MeshFormat): Promise<number> => {
    if (source?.kind === 'file') {
      if (source.formatId === format.id) return source.bytes.length
      return estimateConvertSize(source.bytes, sourceFormat!, format)
    }
    return estimateExportSize(mesh!, format)
  }

  const estimateSizes = async () => {
    if (!mesh || !source) return
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
        const size = await exportSizeFor(format)
        setExportSizes((prev) => ({ ...(prev ?? {}), [format.id]: size }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const downloadExport = async () => {
    if (!mesh || !source) return
    setError(null)
    setBusy('exporting')
    try {
      // Export from the native source of truth, not the viewer's MeshData:
      // same format -> the original bytes untouched; different format ->
      // meshio native-to-native; sample -> serialize its generated MeshData.
      let bytes: Uint8Array<ArrayBuffer>
      if (source.kind === 'file') {
        bytes =
          source.formatId === exportFormat.id
            ? source.bytes
            : await convertMesh(source.bytes, sourceFormat!, exportFormat)
      } else {
        bytes = await serializeMesh(mesh, exportFormat)
      }
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
            {identicalToSource ? (
              <div className="ok">
                Same as the source format — you get the original file back, byte for byte.
              </div>
            ) : losses.length > 0 ? (
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

        {mesh && source && (
          <section>
            <h2>Share</h2>
            <button onClick={shareMesh} disabled={busy !== null}>
              Copy share link
            </button>
            {shareStatus?.kind === 'copied' && (
              <div className="ok">
                Link copied to clipboard ({shareStatus.chars.toLocaleString()} characters).
              </div>
            )}
            {shareStatus?.kind === 'manual' && (
              <div className="warning">
                Couldn’t write to the clipboard — copy the link below by hand.
                <input
                  className="share-url"
                  readOnly
                  value={shareStatus.url}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
            {shareStatus?.kind === 'too-large' && (
              <div className="warning">
                This mesh is too large to share by URL: the link would be{' '}
                {shareStatus.chars.toLocaleString()} characters, beyond the{' '}
                {MAX_SHARE_URL_CHARS.toLocaleString()} that links can reliably carry. Download
                the file and share it directly instead.
              </div>
            )}
            {shareStatus?.kind === 'error' && <div className="error">{shareStatus.message}</div>}
            <p className="footnote">
              The link embeds the compressed mesh (the original file) plus the export and view
              settings in the URL itself — nothing is uploaded anywhere. Whoever opens it can
              view the mesh and download it in any format.
            </p>
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
          <MeshView
            mesh={mesh}
            mode={viewMode}
            onModeChange={setViewMode}
            anaglyph={anaglyph}
            onAnaglyphChange={setAnaglyph}
          />
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
