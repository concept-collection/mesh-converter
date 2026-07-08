# mesh-converter

A static web app for converting meshes between formats: upload a mesh file,
inspect it in an interactive 3D view, and download it in a format of your
choice. Formats differ in what they can store, and the UI shows exactly which
attributes (normals, colors, name) would be dropped by a lossy conversion.

Currently ships with three **invented text formats** to illustrate the
workflow; real formats will replace them later:

| Format | Extension | positions/faces | normals | colors | name |
| --- | --- | --- | --- | --- | --- |
| MOPF (Mesh Omni-Portable Format) | `.mopf` | ✓ | ✓ | ✓ | ✓ |
| TRICOL (TriColor Interchange) | `.tricol` | ✓ | — | ✓ | — |
| BMSH (BareMesh) | `.bmsh` | ✓ | — | — | — |

A built-in sample mesh (a rainbow torus with normals and vertex colors) is
available from the UI for trying things out without a file.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

Built with Vite, React, TypeScript, and three.js (react-three-fiber).

## Adding a format

Implement the `MeshFormat` interface in `src/mesh/formats/` (parse and
serialize against the internal `MeshData` representation, declaring which
optional attributes the format supports) and register it in
`src/mesh/formats/index.ts`. The upload, viewer, capability table, and
loss-warning UI pick it up automatically.
