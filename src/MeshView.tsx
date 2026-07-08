import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshData } from './mesh/types'

type ViewMode = 'shaded' | 'wire' | 'both' | 'points'

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'shaded', label: 'Shaded' },
  { id: 'wire', label: 'Wire' },
  { id: 'both', label: 'Both' },
  { id: 'points', label: 'Points' },
]

const PLAIN_COLOR = '#8fb4d9'

function MeshObject({ mesh, mode }: { mesh: MeshData; mode: ViewMode }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
    g.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1))
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
  const useVertexColors = !!mesh.colors
  // material settings are baked into the compiled shader; remount materials
  // when they change so three.js rebuilds the program
  const matKey = `${mode}-${useVertexColors ? 'vc' : 'plain'}`

  return (
    <group scale={scale}>
      {(mode === 'shaded' || mode === 'both') && (
        <mesh geometry={geometry}>
          <meshStandardMaterial
            key={matKey}
            vertexColors={useVertexColors}
            color={useVertexColors ? 'white' : PLAIN_COLOR}
            roughness={0.55}
            metalness={0.1}
            side={THREE.DoubleSide}
            polygonOffset={mode === 'both'}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}
      {(mode === 'wire' || mode === 'both') && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            key={matKey}
            wireframe
            // over the shaded surface use thin dark lines; standalone
            // wireframe keeps the mesh's own coloring
            vertexColors={mode === 'wire' && useVertexColors}
            color={mode === 'both' ? '#10161f' : useVertexColors ? 'white' : PLAIN_COLOR}
            transparent={mode === 'both'}
            opacity={mode === 'both' ? 0.35 : 1}
          />
        </mesh>
      )}
      {mode === 'points' && (
        <points geometry={geometry}>
          <pointsMaterial
            key={matKey}
            vertexColors={useVertexColors}
            color={useVertexColors ? 'white' : PLAIN_COLOR}
            size={0.02}
          />
        </points>
      )}
    </group>
  )
}

export function MeshView({ mesh }: { mesh: MeshData }) {
  const [mode, setMode] = useState<ViewMode>('both')

  return (
    <>
      <div className="view-toolbar">
        {VIEW_MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'active' : ''}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <Canvas camera={{ position: [2.6, 1.8, 2.6], fov: 45 }}>
        <color attach="background" args={['#16181d']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 4]} intensity={1.6} />
        <directionalLight position={[-4, -3, -6]} intensity={0.4} />
        <MeshObject mesh={mesh} mode={mode} />
        <OrbitControls makeDefault />
      </Canvas>
    </>
  )
}
