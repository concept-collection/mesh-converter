import type { MeshData, MeshFormat } from '../types'
import { mopfFormat } from './mopf'
import { tricolFormat } from './tricol'
import { bmshFormat } from './bmsh'

export const formats: MeshFormat[] = [mopfFormat, tricolFormat, bmshFormat]

export function formatForFilename(filename: string): MeshFormat | null {
  const lower = filename.toLowerCase()
  return formats.find((f) => lower.endsWith(f.extension)) ?? null
}

export const acceptedExtensions = formats.map((f) => f.extension)

/**
 * Human-readable list of attributes of `mesh` that `target` cannot store
 * (empty array means the conversion is lossless).
 */
export function conversionLosses(mesh: MeshData, target: MeshFormat): string[] {
  const losses: string[] = []
  if (mesh.normals && !target.capabilities.normals) losses.push('vertex normals')
  if (mesh.colors && !target.capabilities.colors) losses.push('vertex colors')
  if (mesh.name && !target.capabilities.name) losses.push('mesh name')
  return losses
}
