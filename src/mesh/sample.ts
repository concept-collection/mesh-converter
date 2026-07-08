import type { MeshData } from './types'

/**
 * A torus with analytic normals and rainbow vertex colors — carries every
 * attribute the richest format supports, so lossy export is easy to see.
 */
export function makeSampleMesh(): MeshData {
  const R = 1.0
  const r = 0.4
  const nu = 64 // around the main ring
  const nv = 32 // around the tube

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (let i = 0; i < nu; i++) {
    const u = (i / nu) * 2 * Math.PI
    for (let j = 0; j < nv; j++) {
      const v = (j / nv) * 2 * Math.PI
      positions.push(
        (R + r * Math.cos(v)) * Math.cos(u),
        r * Math.sin(v),
        (R + r * Math.cos(v)) * Math.sin(u),
      )
      normals.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u))
      colors.push(...hslToRgb(i / nu, 0.8, 0.55))
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j
      const b = ((i + 1) % nu) * nv + j
      const c = i * nv + ((j + 1) % nv)
      const d = ((i + 1) % nu) * nv + ((j + 1) % nv)
      indices.push(a, b, d, a, d, c)
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}
