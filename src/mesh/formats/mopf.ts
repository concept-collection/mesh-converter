import type { MeshData, MeshFormat } from '../types'
import { parseNumbers, validateIndices } from '../types'

/**
 * MOPF — "Mesh Omni-Portable Format" (invented, for illustration).
 * The full-fidelity format: positions, faces, normals, colors, mesh name.
 *
 *   MOPF/1
 *   # comment
 *   name Rainbow Torus
 *   attributes position normal color
 *   counts <nVertices> <nFaces>
 *   v <x> <y> <z> [<nx> <ny> <nz>] [<r> <g> <b>]
 *   f <a> <b> <c>
 */
export const mopfFormat: MeshFormat = {
  id: 'mopf',
  label: 'MOPF (Mesh Omni-Portable Format)',
  extension: '.mopf',
  blurb: 'Full-fidelity: geometry, normals, colors, and mesh name.',
  capabilities: { normals: true, colors: true, name: true },

  parse(text: string): MeshData {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
    if (lines[0] !== 'MOPF/1') {
      throw new Error('MOPF: file must start with "MOPF/1"')
    }

    let name: string | null = null
    let attributes = ['position']
    let counts: [number, number] | null = null
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    for (const line of lines.slice(1)) {
      const tokens = line.split(/\s+/)
      const keyword = tokens[0]
      if (keyword === 'name') {
        name = tokens.slice(1).join(' ')
      } else if (keyword === 'attributes') {
        attributes = tokens.slice(1)
        if (attributes[0] !== 'position') {
          throw new Error('MOPF: attributes must start with "position"')
        }
      } else if (keyword === 'counts') {
        const [nv, nf] = parseNumbers(tokens.slice(1), 'MOPF counts')
        counts = [nv, nf]
      } else if (keyword === 'v') {
        const expected = attributes.length * 3
        const nums = parseNumbers(tokens.slice(1), 'MOPF vertex')
        if (nums.length !== expected) {
          throw new Error(`MOPF: vertex line has ${nums.length} numbers, expected ${expected}`)
        }
        let k = 0
        positions.push(...nums.slice(k, (k += 3)))
        if (attributes.includes('normal')) normals.push(...nums.slice(k, (k += 3)))
        if (attributes.includes('color')) colors.push(...nums.slice(k, (k += 3)))
      } else if (keyword === 'f') {
        const nums = parseNumbers(tokens.slice(1), 'MOPF face')
        if (nums.length !== 3) {
          throw new Error('MOPF: face line must have exactly 3 indices')
        }
        indices.push(...nums)
      } else {
        throw new Error(`MOPF: unknown keyword "${keyword}"`)
      }
    }

    const nVertices = positions.length / 3
    if (counts && (counts[0] !== nVertices || counts[1] !== indices.length / 3)) {
      throw new Error(
        `MOPF: counts header says ${counts[0]} vertices / ${counts[1]} faces, ` +
          `found ${nVertices} / ${indices.length / 3}`,
      )
    }
    if (nVertices === 0) throw new Error('MOPF: no vertices found')
    validateIndices(indices, nVertices, 'MOPF')

    return {
      name,
      positions,
      indices,
      normals: normals.length > 0 ? normals : null,
      colors: colors.length > 0 ? colors : null,
    }
  },

  serialize(mesh: MeshData): string {
    const attributes = ['position']
    if (mesh.normals) attributes.push('normal')
    if (mesh.colors) attributes.push('color')
    const nVertices = mesh.positions.length / 3
    const nFaces = mesh.indices.length / 3

    const out: string[] = ['MOPF/1']
    if (mesh.name) out.push(`name ${mesh.name}`)
    out.push(`attributes ${attributes.join(' ')}`)
    out.push(`counts ${nVertices} ${nFaces}`)
    for (let i = 0; i < nVertices; i++) {
      const parts = [fmt3(mesh.positions, i)]
      if (mesh.normals) parts.push(fmt3(mesh.normals, i))
      if (mesh.colors) parts.push(fmt3(mesh.colors, i))
      out.push(`v ${parts.join('  ')}`)
    }
    for (let i = 0; i < nFaces; i++) {
      out.push(`f ${mesh.indices[3 * i]} ${mesh.indices[3 * i + 1]} ${mesh.indices[3 * i + 2]}`)
    }
    return out.join('\n') + '\n'
  },
}

function fmt3(arr: number[], i: number): string {
  return `${round6(arr[3 * i])} ${round6(arr[3 * i + 1])} ${round6(arr[3 * i + 2])}`
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
