# mesh-converter

A static web app for converting meshes between formats: upload a mesh file,
inspect it in an interactive 3D view (shaded, wireframe, shaded + wireframe,
or points), and download it in a format of your choice. Formats differ in what they can store, and the UI shows exactly which
attributes (normals, colors) would be dropped by a lossy conversion.

Conversion is powered by [meshio](https://github.com/nschloe/meshio) running
in the browser via [Pyodide](https://pyodide.org) — no server, all mesh I/O
happens client-side. The first visit downloads the Python runtime (~15 MB from
the jsDelivr CDN, cached afterwards).

| Format | Extension | positions/faces | normals | colors | notes |
| --- | --- | --- | --- | --- | --- |
| PLY (Polygon File Format) | `.ply` | ✓ | ✓ | ✓ | |
| Wavefront OBJ | `.obj` | ✓ | ✓ | — | |
| STL | `.stl` | ✓ | — | — | binary |
| OFF (Object File Format) | `.off` | ✓ | — | — | |
| VTK legacy | `.vtk` | ✓ | ✓ | ✓ | |
| VTU (VTK XML) | `.vtu` | ✓ | ✓ | ✓ | |
| Gmsh MSH | `.msh` | ✓ | — | — | |
| XDMF | `.xdmf` | ✓ | ✓ | ✓ | h5py† |
| MED (Salome) | `.med` | ✓ | ✓ | ✓ | h5py† |
| H5M (MOAB) | `.h5m` | ✓ | ✓ | ✓ | h5py† |
| AVS-UCD | `.avs` | ✓ | ✓ | ✓ | |
| Abaqus | `.inp` | ✓ | — | — | |
| Nastran | `.bdf` | ✓ | — | — | |
| Medit | `.mesh` | ✓ | — | — | |
| Netgen | `.vol` | ✓ | — | — | |
| MDPA (Kratos) | `.mdpa` | ✓ | — | — | |
| Tecplot | `.dat` | ✓ | — | — | |
| DOLFIN XML | `.xml` | ✓ | — | — | |
| PERMAS | `.post` | ✓ | — | — | |

† HDF5-based formats need the h5py Pyodide package (~4 MB); it is loaded
lazily the first time such a format is used, so the default footprint stays
small.

✓ marks what this app preserves when writing the format: vertex normals map to
each format's native representation (`nx/ny/nz` properties in PLY, `vn` lines
in OBJ, a `Normals` point-data array elsewhere) and vertex colors likewise
(`red/green/blue` in PLY, an `RGB` point-data array elsewhere). On import,
quads and polygons are fan-triangulated; volume cells are skipped.

Some meshio formats are deliberately absent: ansys, cgns, su2, and ugrid
cannot roundtrip their own output in meshio 5.3.5; exodus fails writing under
wasm; flac3d holds volume cells only; wkt's reader hangs on non-toy meshes;
tetgen spans two files; svg is write-only.

A built-in sample mesh (a rainbow torus with normals and vertex colors) is
available from the UI for trying things out without a file, and `examples/`
holds it pre-exported in a few formats. An on-demand "estimate export sizes"
action serializes the loaded mesh to every format in memory and shows the
resulting file sizes in the format table and export dropdown.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

Built with Vite, React, TypeScript, and three.js (react-three-fiber).

## How it works

- `src/mesh/bridge.py` runs inside Pyodide: it reads/writes mesh files with
  meshio and exchanges arrays with JS as raw little-endian buffers through
  Pyodide's in-memory filesystem.
- `src/mesh/meshio.ts` loads Pyodide (script tag in `index.html`), installs
  meshio via micropip, and wraps the bridge in typed async
  `parseMeshFile`/`serializeMesh` functions built on the internal `MeshData`
  representation (typed arrays of positions, triangle indices, optional
  normals/colors).
- `src/mesh/formats.ts` declares the supported formats and which attributes
  each preserves; the upload, capability table, and loss-warning UI derive
  from it. To add a meshio-supported format, add a descriptor there (with
  `pyodidePackages` if it needs extra prebuilt packages such as h5py) and, if
  it stores normals/colors in a format-specific way, teach
  `bridge.py` how to map them.
