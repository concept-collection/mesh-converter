/**
 * Internal mesh representation. Every format parses into this and
 * serializes out of it. Optional attributes are null when absent.
 */
export interface MeshData {
  /** Human-readable mesh name (not all formats can store one) */
  name: string | null
  /** Flat xyz triples, 3 numbers per vertex */
  positions: number[]
  /** Flat triangle indices (0-based), 3 numbers per face */
  indices: number[]
  /** Flat xyz triples, 3 numbers per vertex, or null */
  normals: number[] | null
  /** Flat rgb triples in [0,1], 3 numbers per vertex, or null */
  colors: number[] | null
}

export interface MeshCapabilities {
  normals: boolean
  colors: boolean
  name: boolean
}

export interface MeshFormat {
  id: string
  label: string
  /** File extension including the dot, e.g. ".mopf" */
  extension: string
  blurb: string
  capabilities: MeshCapabilities
  /** Parse file text; throws Error with a user-facing message on bad input */
  parse(text: string): MeshData
  /** Serialize, silently dropping attributes the format cannot hold */
  serialize(mesh: MeshData): string
}

export function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3
}

export function faceCount(mesh: MeshData): number {
  return mesh.indices.length / 3
}

export function parseNumbers(tokens: string[], context: string): number[] {
  return tokens.map((t) => {
    const x = Number(t)
    if (!Number.isFinite(x)) {
      throw new Error(`${context}: "${t}" is not a number`)
    }
    return x
  })
}

export function validateIndices(indices: number[], nVertices: number, context: string): void {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= nVertices) {
      throw new Error(`${context}: face index ${i} out of range (0..${nVertices - 1})`)
    }
  }
}
