import type { MeshData, MeshFormat } from '../types'
import { parseNumbers, validateIndices } from '../types'

/**
 * TRICOL — "TriColor Interchange" (invented, for illustration).
 * Comma-separated records, one per line. Stores geometry and optional
 * per-vertex colors, but no normals and no mesh name.
 *
 *   # comment
 *   V,<x>,<y>,<z>[,<r>,<g>,<b>]
 *   F,<a>,<b>,<c>
 */
export const tricolFormat: MeshFormat = {
  id: 'tricol',
  label: 'TRICOL (TriColor Interchange)',
  extension: '.tricol',
  blurb: 'Geometry plus vertex colors. No normals, no mesh name.',
  capabilities: { normals: false, colors: true, name: false },

  parse(text: string): MeshData {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    let sawColorless = false

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0 || line.startsWith('#')) continue
      const tokens = line.split(',').map((t) => t.trim())
      const kind = tokens[0]
      if (kind === 'V') {
        const nums = parseNumbers(tokens.slice(1), 'TRICOL vertex')
        if (nums.length === 3) {
          sawColorless = true
        } else if (nums.length === 6) {
          colors.push(nums[3], nums[4], nums[5])
        } else {
          throw new Error(`TRICOL: V record needs 3 or 6 numbers, got ${nums.length}`)
        }
        positions.push(nums[0], nums[1], nums[2])
      } else if (kind === 'F') {
        const nums = parseNumbers(tokens.slice(1), 'TRICOL face')
        if (nums.length !== 3) {
          throw new Error('TRICOL: F record must have exactly 3 indices')
        }
        indices.push(...nums)
      } else {
        throw new Error(`TRICOL: unknown record type "${kind}"`)
      }
    }

    const nVertices = positions.length / 3
    if (nVertices === 0) throw new Error('TRICOL: no vertices found')
    if (colors.length > 0 && sawColorless) {
      throw new Error('TRICOL: either all V records have colors or none do')
    }
    validateIndices(indices, nVertices, 'TRICOL')

    return {
      name: null,
      positions,
      indices,
      normals: null,
      colors: colors.length > 0 ? colors : null,
    }
  },

  serialize(mesh: MeshData): string {
    const nVertices = mesh.positions.length / 3
    const nFaces = mesh.indices.length / 3
    const out: string[] = ['# TRICOL mesh']
    for (let i = 0; i < nVertices; i++) {
      const p = [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]
      const fields = p.map(round6)
      if (mesh.colors) {
        fields.push(
          round6(mesh.colors[3 * i]),
          round6(mesh.colors[3 * i + 1]),
          round6(mesh.colors[3 * i + 2]),
        )
      }
      out.push(`V,${fields.join(',')}`)
    }
    for (let i = 0; i < nFaces; i++) {
      out.push(`F,${mesh.indices[3 * i]},${mesh.indices[3 * i + 1]},${mesh.indices[3 * i + 2]}`)
    }
    return out.join('\n') + '\n'
  },
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
