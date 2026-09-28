/**
 * Internal mesh representation: a triangle mesh with optional per-vertex
 * attributes. Every format parses into this and serializes out of it.
 */
export interface MeshData {
  /** Flat xyz triples, 3 numbers per vertex */
  positions: Float32Array
  /** Flat triangle indices (0-based), 3 numbers per face */
  indices: Uint32Array
  /**
   * Flat index pairs for the unique edges of the original polygons, so the
   * wireframe view can show quads/polygons as authored rather than their
   * triangulation; null falls back to triangle edges
   */
  edges: Uint32Array | null
  /** Flat xyz triples, 3 numbers per vertex, or null */
  normals: Float32Array | null
  /** Flat rgb triples in [0,1], 3 numbers per vertex, or null */
  colors: Float32Array | null
}

export interface MeshCapabilities {
  normals: boolean
  colors: boolean
}

export function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3
}

export function faceCount(mesh: MeshData): number {
  return mesh.indices.length / 3
}
