import type { MeshData, MeshFormat } from '../types'
import { parseNumbers, validateIndices } from '../types'

/**
 * BMSH — "BareMesh" (invented, for illustration).
 * The minimal format: raw geometry only. No normals, colors, or name.
 *
 *   BMSH
 *   <nVertices> <nFaces>
 *   <x> <y> <z>          (nVertices lines)
 *   <a> <b> <c>          (nFaces lines)
 */
export const bmshFormat: MeshFormat = {
  id: 'bmsh',
  label: 'BMSH (BareMesh)',
  extension: '.bmsh',
  blurb: 'Bare geometry only: positions and faces, nothing else.',
  capabilities: { normals: false, colors: false, name: false },

  parse(text: string): MeshData {
    const tokens = text.split(/\s+/).filter((t) => t.length > 0)
    if (tokens[0] !== 'BMSH') {
      throw new Error('BMSH: file must start with "BMSH"')
    }
    const nums = parseNumbers(tokens.slice(1), 'BMSH')
    const nVertices = nums[0]
    const nFaces = nums[1]
    if (!Number.isInteger(nVertices) || !Number.isInteger(nFaces) || nVertices <= 0 || nFaces < 0) {
      throw new Error('BMSH: invalid vertex/face counts')
    }
    const expected = 2 + nVertices * 3 + nFaces * 3
    if (nums.length !== expected) {
      throw new Error(`BMSH: expected ${expected - 2} numbers after counts, got ${nums.length - 2}`)
    }
    const positions = nums.slice(2, 2 + nVertices * 3)
    const indices = nums.slice(2 + nVertices * 3)
    validateIndices(indices, nVertices, 'BMSH')

    return { name: null, positions, indices, normals: null, colors: null }
  },

  serialize(mesh: MeshData): string {
    const nVertices = mesh.positions.length / 3
    const nFaces = mesh.indices.length / 3
    const out: string[] = ['BMSH', `${nVertices} ${nFaces}`]
    for (let i = 0; i < nVertices; i++) {
      out.push(
        `${round6(mesh.positions[3 * i])} ${round6(mesh.positions[3 * i + 1])} ${round6(mesh.positions[3 * i + 2])}`,
      )
    }
    for (let i = 0; i < nFaces; i++) {
      out.push(`${mesh.indices[3 * i]} ${mesh.indices[3 * i + 1]} ${mesh.indices[3 * i + 2]}`)
    }
    return out.join('\n') + '\n'
  },
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
