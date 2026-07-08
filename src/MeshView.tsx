import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshData } from './mesh/types'

function MeshObject({ mesh }: { mesh: MeshData }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
    g.setIndex(mesh.indices)
    if (mesh.normals) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3))
    } else {
      g.computeVertexNormals()
    }
    if (mesh.colors) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3))
    }
    // Center and scale to a consistent size so the fixed camera always frames it
    g.center()
    g.computeBoundingSphere()
    return g
  }, [mesh])

  useEffect(() => () => geometry.dispose(), [geometry])

  const scale = 1.6 / (geometry.boundingSphere?.radius || 1)

  return (
    <mesh geometry={geometry} scale={scale}>
      <meshStandardMaterial
        vertexColors={!!mesh.colors}
        color={mesh.colors ? 'white' : '#8fb4d9'}
        roughness={0.55}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function MeshView({ mesh }: { mesh: MeshData }) {
  return (
    <Canvas camera={{ position: [2.6, 1.8, 2.6], fov: 45 }}>
      <color attach="background" args={['#16181d']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 4]} intensity={1.6} />
      <directionalLight position={[-4, -3, -6]} intensity={0.4} />
      <MeshObject mesh={mesh} />
      <OrbitControls makeDefault />
    </Canvas>
  )
}
