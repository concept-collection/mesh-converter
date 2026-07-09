/**
 * JS side of the meshio bridge. Loads Pyodide (from the script tag in
 * index.html), installs meshio via micropip, and exchanges mesh arrays with
 * bridge.py through Pyodide's in-memory filesystem — everything runs in the
 * browser, no server involved.
 */
import bridgeCode from './bridge.py?raw'
import type { MeshData } from './types'
import type { MeshFormat } from './formats'

const PYODIDE_PACKAGES = ['micropip']
const MESHIO_SPEC = 'meshio==5.3.5'

const POSITIONS_F32 = '/work/positions.f32'
const INDICES_U32 = '/work/indices.u32'
const NORMALS_F32 = '/work/normals.f32'
const COLORS_F32 = '/work/colors.f32'

interface Pyodide {
  runPython(code: string): unknown
  loadPackage(names: string[]): Promise<unknown>
  pyimport(name: string): { install(spec: string): Promise<void> }
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array<ArrayBuffer>
    unlink(path: string): void
    mkdirTree(path: string): void
  }
}

declare global {
  // provided by the pyodide.js script tag in index.html
  function loadPyodide(options?: { indexURL?: string }): Promise<Pyodide>
}

export interface ParseInfo {
  numVertices: number
  numFaces: number
  hasNormals: boolean
  hasColors: boolean
  warnings: string[]
}

let initPromise: Promise<Pyodide> | null = null

async function doInit(onProgress: (message: string) => void): Promise<Pyodide> {
  if (typeof loadPyodide !== 'function') {
    throw new Error('Pyodide script failed to load (offline? blocked CDN?)')
  }
  onProgress('Loading Python runtime (Pyodide)…')
  const pyodide = await loadPyodide()
  onProgress('Installing meshio…')
  await pyodide.loadPackage(PYODIDE_PACKAGES)
  await pyodide.pyimport('micropip').install(MESHIO_SPEC)
  pyodide.runPython(bridgeCode)
  return pyodide
}

/**
 * Kick off (or join) the one-time Pyodide + meshio setup. Safe to call
 * repeatedly; only the first caller's onProgress is used.
 */
export function initMeshio(onProgress: (message: string) => void = () => {}): Promise<Pyodide> {
  if (!initPromise) initPromise = doInit(onProgress)
  return initPromise
}

export async function getMeshioVersion(): Promise<string> {
  const pyodide = await initMeshio()
  return String(pyodide.runPython('meshio.__version__'))
}

const loadedPackages = new Set<string>()

/**
 * Load a format's extra Pyodide packages (e.g. h5py) on first use, so the
 * default startup stays at just meshio + numpy.
 */
async function ensurePackages(pyodide: Pyodide, format: MeshFormat): Promise<void> {
  const needed = (format.pyodidePackages ?? []).filter((p) => !loadedPackages.has(p))
  if (needed.length === 0) return
  await pyodide.loadPackage(needed)
  needed.forEach((p) => loadedPackages.add(p))
}

/** Last line of a Python traceback, without the exception class name. */
function pythonErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const lines = raw
    .trim()
    .split('\n')
    .filter((l) => l.trim())
  const last = lines[lines.length - 1] ?? raw
  return last.replace(/^[\w.]+(?:Error|Exception|Exit)\s*:\s*/, '')
}

function runBridge(pyodide: Pyodide, code: string): string {
  try {
    return String(pyodide.runPython(code))
  } catch (err) {
    throw new Error(pythonErrorMessage(err))
  }
}

function readF32(pyodide: Pyodide, path: string): Float32Array {
  const bytes = pyodide.FS.readFile(path)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function readU32(pyodide: Pyodide, path: string): Uint32Array {
  const bytes = pyodide.FS.readFile(path)
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function asBytes(array: Float32Array | Uint32Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
}

export async function parseMeshFile(
  bytes: Uint8Array,
  format: MeshFormat,
): Promise<{ mesh: MeshData; info: ParseInfo }> {
  const pyodide = await initMeshio()
  await ensurePackages(pyodide, format)
  const inputPath = '/work/input' + format.extension
  pyodide.FS.mkdirTree('/work')
  pyodide.FS.writeFile(inputPath, bytes)
  const info: ParseInfo = JSON.parse(
    runBridge(
      pyodide,
      `parse_mesh_file(${JSON.stringify(inputPath)}, ${JSON.stringify(format.id)})`,
    ),
  )
  const mesh: MeshData = {
    positions: readF32(pyodide, POSITIONS_F32),
    indices: readU32(pyodide, INDICES_U32),
    normals: info.hasNormals ? readF32(pyodide, NORMALS_F32) : null,
    colors: info.hasColors ? readF32(pyodide, COLORS_F32) : null,
  }
  pyodide.FS.unlink(inputPath)
  return { mesh, info }
}

/**
 * Native -> native conversion: write the original file bytes into /work and
 * run convert_mesh, returning [pyodide, outPath, byteLength]. Both formats'
 * extra packages are ensured — the source format's are needed to read, the
 * target's to write.
 */
async function runConvert(
  bytes: Uint8Array,
  srcFormat: MeshFormat,
  dstFormat: MeshFormat,
): Promise<[Pyodide, string, number]> {
  const pyodide = await initMeshio()
  await ensurePackages(pyodide, srcFormat)
  await ensurePackages(pyodide, dstFormat)
  pyodide.FS.mkdirTree('/work')
  const inPath = '/work/convert_in' + srcFormat.extension
  const outPath = '/work/convert_out' + dstFormat.extension
  pyodide.FS.writeFile(inPath, bytes)
  const result = runBridge(
    pyodide,
    `convert_mesh(${JSON.stringify(inPath)}, ${JSON.stringify(srcFormat.id)}, ` +
      `${JSON.stringify(outPath)}, ${JSON.stringify(dstFormat.id)})`,
  )
  pyodide.FS.unlink(inPath)
  const { byteLength } = JSON.parse(result) as { byteLength: number }
  return [pyodide, outPath, byteLength]
}

/**
 * Convert the original file bytes from `srcFormat` to `dstFormat` through
 * meshio directly (no detour through the viewer's common representation), so
 * only what `dstFormat` cannot express is lost. Callers should short-circuit
 * the same-format case and hand back the original bytes untouched.
 */
export async function convertMesh(
  bytes: Uint8Array,
  srcFormat: MeshFormat,
  dstFormat: MeshFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  const [pyodide, outPath] = await runConvert(bytes, srcFormat, dstFormat)
  const out = pyodide.FS.readFile(outPath)
  pyodide.FS.unlink(outPath)
  return out
}

/** Byte size `bytes` would have converted to `dstFormat`, without keeping the bytes. */
export async function estimateConvertSize(
  bytes: Uint8Array,
  srcFormat: MeshFormat,
  dstFormat: MeshFormat,
): Promise<number> {
  const [pyodide, outPath, byteLength] = await runConvert(bytes, srcFormat, dstFormat)
  pyodide.FS.unlink(outPath)
  return byteLength
}

/** Write the mesh arrays into /work and run serialize_mesh; returns [pyodide, outPath, byteLength]. */
async function runSerialize(
  mesh: MeshData,
  format: MeshFormat,
): Promise<[Pyodide, string, number]> {
  const pyodide = await initMeshio()
  await ensurePackages(pyodide, format)
  pyodide.FS.mkdirTree('/work')
  pyodide.FS.writeFile(POSITIONS_F32, asBytes(mesh.positions))
  pyodide.FS.writeFile(INDICES_U32, asBytes(mesh.indices))
  const includeNormals = !!mesh.normals && format.capabilities.normals
  const includeColors = !!mesh.colors && format.capabilities.colors
  if (includeNormals) pyodide.FS.writeFile(NORMALS_F32, asBytes(mesh.normals!))
  if (includeColors) pyodide.FS.writeFile(COLORS_F32, asBytes(mesh.colors!))

  const outPath = '/work/out' + format.extension
  const result = runBridge(
    pyodide,
    `serialize_mesh(${JSON.stringify(outPath)}, ${JSON.stringify(format.id)}, ` +
      `${includeNormals ? 'True' : 'False'}, ${includeColors ? 'True' : 'False'})`,
  )
  const { byteLength } = JSON.parse(result) as { byteLength: number }
  return [pyodide, outPath, byteLength]
}

/**
 * Serialize the common-form `MeshData` to `format`. Used for the generated
 * sample mesh, which has no original file; uploaded files export losslessly
 * through {@link convertMesh} from their original bytes instead.
 */
export async function serializeMesh(
  mesh: MeshData,
  format: MeshFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  const [pyodide, outPath] = await runSerialize(mesh, format)
  const out = pyodide.FS.readFile(outPath)
  pyodide.FS.unlink(outPath)
  return out
}

/** Byte size the mesh would have in `format`, without keeping the bytes. */
export async function estimateExportSize(mesh: MeshData, format: MeshFormat): Promise<number> {
  const [pyodide, outPath, byteLength] = await runSerialize(mesh, format)
  pyodide.FS.unlink(outPath)
  return byteLength
}
