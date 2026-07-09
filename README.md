# mesh-converter

A static web app for converting meshes between formats: upload a mesh file,
inspect it in an interactive 3D view (shaded, wireframe, shaded + wireframe,
or points, with an optional anaglyph stereo mode for red/cyan 3D glasses),
and download it in a format of your choice. Formats differ in what they can store, and the UI shows exactly which
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
| Gmsh MSH | `.msh` | ✓ | ✓ | ✓ | |
| XDMF | `.xdmf` | ✓ | ✓ | ✓ | h5py† |
| MED (Salome) | `.med` | ✓ | ✓ | ✓ | h5py† |
| H5M (MOAB) | `.h5m` | ✓ | ✓ | ✓ | h5py† |
| AVS-UCD | `.avs` | ✓ | ✓ | ✓ | |
| Abaqus | `.inp` | ✓ | — | — | |
| Nastran | `.bdf` | ✓ | — | — | |
| Medit | `.mesh` | ✓ | — | — | |
| Netgen | `.vol` | ✓ | — | — | |
| MDPA (Kratos) | `.mdpa` | ✓ | — | — | |
| Tecplot | `.dat` | ✓ | ✓ | ✓ | |
| DOLFIN XML | `.xml` | ✓ | — | — | |
| PERMAS | `.post` | ✓ | — | — | |

† HDF5-based formats need the h5py Pyodide package (~4 MB); it is loaded
lazily the first time such a format is used, so the default footprint stays
small.

A loaded file is kept in its original bytes, in its original format — that is
the source of truth. Export runs meshio directly on those bytes
(`read` the original, `write` the target), so a conversion drops only what the
target format genuinely cannot express, and exporting back to the *same* format
returns the original file byte-for-byte with no conversion at all. During
conversion the app translates vertex normals and colors between the formats'
native representations (so PLY's `nx/ny/nz` properties become `vn` lines in
OBJ, and so on), normalizes byte order and integer widths where meshio's
writers are picky about dtypes, and strips data that meshio 5.3.5 would write
corruptly (MDPA mesh data) or crash on (H5M and DOLFIN XML cell data). The 3D
view is fed by a separate, triangle-only "common" representation: quads and
polygons are fan-triangulated and volume cells are skipped *for display*, but
none of that touches what gets exported.

✓ marks the attributes the app tracks for its loss warnings, and is how it
writes the generated sample mesh (which, unlike an uploaded file, has no
original bytes): vertex normals map to each format's native representation
(`nx/ny/nz` scalars in PLY and Tecplot, `vn` lines in OBJ, a `Normals`
point-data array elsewhere) and vertex colors likewise (`red/green/blue` in
PLY and Tecplot, an `RGB` point-data array elsewhere).

Some meshio formats are deliberately absent: ansys, cgns, su2, and ugrid
cannot roundtrip their own output in meshio 5.3.5; exodus fails writing under
wasm; flac3d holds volume cells only; wkt's reader hangs on non-toy meshes;
tetgen spans two files; svg is write-only.

A built-in sample mesh (a rainbow torus with normals and vertex colors) is
available from the UI for trying things out without a file, and `examples/`
holds it pre-exported in a few formats. An on-demand "estimate export sizes"
action serializes the loaded mesh to every format in memory and shows the
resulting file sizes in the format table and export dropdown.

A loaded mesh can be shared as a self-contained link: "Copy share link" packs
the original uploaded file (byte-identical, in its original format) together
with the chosen export format and view mode into the URL fragment —
deflate-compressed and base64url-encoded after `#share=`. Nothing is uploaded;
the data lives in the URL itself, so whoever opens the link sees the mesh and
can download it in any format. Links are capped at 65,000 characters (roughly
a 100–300 KB mesh file, depending on how well it compresses); beyond that the
app says the mesh is too large to share by URL.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

Built with Vite, React, TypeScript, and three.js (react-three-fiber).

## How it works

- `src/mesh/bridge.py` runs inside Pyodide with three entry points:
  `parse_mesh_file` (native file → the triangle-only common form that feeds the
  viewer), `convert_mesh` (native → native, straight through meshio, the export
  path for uploaded files), and `serialize_mesh` (common form → native, used
  only for the generated sample). It exchanges arrays with JS as raw
  little-endian buffers through Pyodide's in-memory filesystem.
- `src/mesh/meshio.ts` loads Pyodide (script tag in `index.html`), installs
  meshio via micropip, and wraps the bridge in typed async functions:
  `parseMeshFile` for the viewer's `MeshData` (typed arrays of positions,
  triangle indices, optional normals/colors), `convertMesh` for lossless
  native-to-native export, and `serializeMesh` for the sample. `App.tsx` keeps
  the loaded file's original bytes as the source of truth and routes export
  through them — same-format exports skip meshio entirely.
- `src/mesh/formats.ts` declares the supported formats and which attributes
  each preserves; the upload, capability table, and loss-warning UI derive
  from it. To add a meshio-supported format, add a descriptor there (with
  `pyodidePackages` if it needs extra prebuilt packages such as h5py) and, if
  it stores normals/colors in a format-specific way, teach
  `bridge.py` how to map them.
