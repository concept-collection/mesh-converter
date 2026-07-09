# Runs inside Pyodide. Bridges meshio to the JS app.
#
# There are two directions:
#   * parse_mesh_file  — native file -> the app's triangle-only "common"
#     representation, used to feed the 3D viewer. This is lossy by design
#     (cells are triangulated, only normals/colors are carried).
#   * convert_mesh     — native file -> native file, going straight through
#     meshio with no detour through the common representation, so nothing the
#     source format holds is discarded beyond what the target format cannot
#     express. This is the export path for uploaded/shared files.
#   * serialize_mesh   — common representation -> native file, used only for
#     the built-in sample mesh, which is generated as the common form and so
#     has no original file to preserve.
#
# Arrays cross the JS/Python boundary as little-endian binary files in
# Pyodide's in-memory filesystem (positions/normals/colors as float32
# xyz-triples, indices as uint32 triangle triples); each call returns a JSON
# string with counts, flags, and warnings. See meshio.ts for the JS side.

import json
import os

import numpy as np

import meshio

WORK = "/work"

POSITIONS_F32 = WORK + "/positions.f32"
INDICES_U32 = WORK + "/indices.u32"
NORMALS_F32 = WORK + "/normals.f32"
COLORS_F32 = WORK + "/colors.f32"

os.makedirs(WORK, exist_ok=True)


def _triangulate_cells(mesh, warnings):
    """Collect surface cells as triangles, fan-triangulating quads/polygons."""
    tri_blocks = []
    skipped = []
    for block in mesh.cells:
        data = block.data
        if not isinstance(data, np.ndarray) or data.ndim != 2 or data.shape[1] < 3:
            skipped.append(block.type)
            continue
        if block.type == "triangle":
            tri_blocks.append(data)
        elif block.type in ("quad", "polygon"):
            k = data.shape[1]
            for i in range(1, k - 1):
                tri_blocks.append(np.column_stack([data[:, 0], data[:, i], data[:, i + 1]]))
            if k > 3:
                warnings.append(f"{len(data)} {block.type} cells triangulated")
        else:
            skipped.append(block.type)
    if skipped:
        warnings.append("skipped non-surface cells: " + ", ".join(sorted(set(skipped))))
    if not tri_blocks:
        found = ", ".join(sorted({b.type for b in mesh.cells})) or "none"
        raise ValueError(
            f"No surface cells (triangle/quad/polygon) found; cell types in file: {found}"
        )
    return np.ascontiguousarray(np.vstack(tri_blocks).astype(np.uint32))


# Formats whose meshio writer+reader round-trip vertex normals/colors via the
# conventions in _attach_normals/_attach_colors. Mirrors `capabilities` in
# formats.ts — keep the two in sync.
NORMAL_FORMATS = {"ply", "obj", "vtk", "vtu", "gmsh", "xdmf", "med", "h5m", "avsucd", "tecplot"}
COLOR_FORMATS = NORMAL_FORMATS - {"obj"}

_NORMAL_ALIASES = ("normals", "normal")
_COLOR_ALIASES = ("rgb", "rgba", "colors", "color")


def _extract_normals(mesh):
    pd = mesh.point_data
    if "obj:vn" in pd:  # wavefront obj
        vn = np.asarray(pd["obj:vn"], dtype=np.float32)
        if vn.ndim == 2 and vn.shape[1] >= 3:
            return vn[:, :3]
    if all(k in pd for k in ("nx", "ny", "nz")):  # ply/tecplot convention
        return np.column_stack([pd["nx"], pd["ny"], pd["nz"]]).astype(np.float32)
    for key, value in pd.items():
        value = np.asarray(value)
        if key.lower() in _NORMAL_ALIASES and value.ndim == 2 and value.shape[1] == 3:
            return value.astype(np.float32)
    return None


def _rgb_to_unit_float(rgb):
    """Color channels as float32 in [0, 1]. Integer data is assumed 0-255;
    float data that exceeds 1 is treated as 0-255 too (formats like tecplot
    and gmsh store everything as floats, losing the integer dtype)."""
    rgb = np.asarray(rgb)
    if np.issubdtype(rgb.dtype, np.integer):
        return (rgb / 255.0).astype(np.float32)
    rgb = rgb.astype(np.float32)
    if rgb.size and float(rgb.max()) > 1.0:
        rgb = rgb / np.float32(255.0)
    return rgb


def _extract_colors(mesh):
    """Vertex colors as float32 rgb in [0, 1], or None."""
    pd = mesh.point_data
    if all(k in pd for k in ("red", "green", "blue")):  # ply/tecplot convention
        return _rgb_to_unit_float(np.column_stack([pd["red"], pd["green"], pd["blue"]]))
    for key, value in pd.items():
        value = np.asarray(value)
        if key.lower() in _COLOR_ALIASES and value.ndim == 2 and value.shape[1] >= 3:
            return _rgb_to_unit_float(value[:, :3])
    return None


def _attach_normals(point_data, file_format, normals):
    """Attach vertex normals under file_format's native naming."""
    if file_format == "obj":
        point_data["obj:vn"] = normals
    elif file_format in ("ply", "tecplot"):
        # scalar properties/variables; tecplot would split a 2D array into
        # opaque Normals_0/1/2 columns
        point_data["nx"] = normals[:, 0]
        point_data["ny"] = normals[:, 1]
        point_data["nz"] = normals[:, 2]
    else:
        point_data["Normals"] = normals


def _attach_colors(point_data, file_format, colors):
    """Attach vertex colors (float rgb in [0, 1]) under file_format's native
    naming."""
    if file_format == "ply":
        rgb = np.clip(np.round(colors * 255.0), 0, 255).astype(np.uint8)
        point_data["red"] = rgb[:, 0]
        point_data["green"] = rgb[:, 1]
        point_data["blue"] = rgb[:, 2]
    elif file_format == "tecplot":
        point_data["red"] = colors[:, 0]
        point_data["green"] = colors[:, 1]
        point_data["blue"] = colors[:, 2]
    else:
        point_data["RGB"] = colors


def parse_mesh_file(path, file_format=None):
    warnings = []
    try:
        # meshio's read helper exits the interpreter when every candidate
        # reader fails; turn that into a normal exception
        mesh = meshio.read(path, file_format)
    except SystemExit:
        raise ValueError(f"Could not read file as {file_format or 'any known format'}")

    points = np.asarray(mesh.points, dtype=np.float32)
    if points.ndim != 2:
        raise ValueError(f"Unexpected points array shape {points.shape}")
    if points.shape[1] == 2:
        points = np.column_stack([points, np.zeros(len(points), dtype=np.float32)])
        warnings.append("2D points: added z=0")
    points = np.ascontiguousarray(points[:, :3])

    triangles = _triangulate_cells(mesh, warnings)
    if triangles.size and int(triangles.max()) >= len(points):
        raise ValueError(
            f"Face index {int(triangles.max())} out of range (0..{len(points) - 1})"
        )

    normals = _extract_normals(mesh)
    colors = _extract_colors(mesh)
    # per-vertex attributes must match the vertex count to be usable
    if normals is not None and len(normals) != len(points):
        normals = None
    if colors is not None and len(colors) != len(points):
        colors = None

    with open(POSITIONS_F32, "wb") as f:
        f.write(points.tobytes())
    with open(INDICES_U32, "wb") as f:
        f.write(triangles.tobytes())
    if normals is not None:
        with open(NORMALS_F32, "wb") as f:
            f.write(np.ascontiguousarray(normals).tobytes())
    if colors is not None:
        with open(COLORS_F32, "wb") as f:
            f.write(np.ascontiguousarray(np.clip(colors, 0.0, 1.0)).tobytes())

    other_point_data = sorted(
        k for k in mesh.point_data
        if k not in ("obj:vn", "nx", "ny", "nz", "red", "green", "blue")
        and k.lower() not in _NORMAL_ALIASES + _COLOR_ALIASES
        # format-internal bookkeeping, not user data
        and not k.startswith(("gmsh:", "medit:", "nastran:"))
        and k != "GLOBAL_ID"
    )
    if other_point_data:
        warnings.append("ignored point data: " + ", ".join(other_point_data))

    return json.dumps(
        {
            "numVertices": len(points),
            "numFaces": len(triangles),
            "hasNormals": normals is not None,
            "hasColors": colors is not None,
            "warnings": warnings,
        }
    )


def _write_kwargs(file_format):
    """Per-format quirks for meshio.write, shared by both write paths."""
    kwargs = {}
    if file_format == "stl":
        kwargs["binary"] = True  # meshio defaults STL to ASCII
    elif file_format == "xdmf":
        # default "HDF" puts the data in a companion .h5 file, which a
        # single-file download can't deliver; inline it in the XML instead
        kwargs["data_format"] = "XML"
    return kwargs


def _native_order(arr):
    """Byte-swap to native endianness. Legacy VTK reads come back big-endian,
    and several writers (ply, medit) look dtypes up in tables keyed by the
    native forms only."""
    arr = np.asarray(arr)
    if not arr.dtype.isnative:
        return arr.astype(arr.dtype.newbyteorder("="))
    return arr


def _normalize_arrays(mesh):
    mesh.points = _native_order(mesh.points)
    for block in mesh.cells:
        block.data = _native_order(block.data)
    for key, value in list(mesh.point_data.items()):
        mesh.point_data[key] = _native_order(value)
    for key, blocks in list(mesh.cell_data.items()):
        mesh.cell_data[key] = [_native_order(b) for b in blocks]


def _pop_normal_keys(pd):
    """Remove every recognized representation of vertex normals."""
    pd.pop("obj:vn", None)
    if all(k in pd for k in ("nx", "ny", "nz")):
        for k in ("nx", "ny", "nz"):
            del pd[k]
    for key in [k for k in pd if k.lower() in _NORMAL_ALIASES]:
        del pd[key]


def _pop_color_keys(pd):
    if all(k in pd for k in ("red", "green", "blue")):
        for k in ("red", "green", "blue"):
            del pd[k]
    for key in [k for k in pd if k.lower() in _COLOR_ALIASES]:
        del pd[key]


def _remap_attributes(mesh, out_format):
    """Translate vertex normals/colors from the source format's naming into
    out_format's native naming so they survive conversion (PLY's nx/ny/nz
    become OBJ vn lines, and so on). Unrecognized point data passes through
    untouched. Attributes the target cannot express are removed rather than
    left under a name its writer would drop or mangle."""
    num_points = len(mesh.points)
    normals = _extract_normals(mesh)
    if normals is not None and len(normals) == num_points:
        _pop_normal_keys(mesh.point_data)
        if out_format in NORMAL_FORMATS:
            _attach_normals(mesh.point_data, out_format, np.ascontiguousarray(normals))
    colors = _extract_colors(mesh)
    if colors is not None and len(colors) == num_points:
        _pop_color_keys(mesh.point_data)
        if out_format in COLOR_FORMATS:
            _attach_colors(mesh.point_data, out_format, np.clip(colors, 0.0, 1.0))


def _sanitize_for_target(mesh, out_format):
    """Work around meshio 5.3.5 writer defects that would crash or corrupt
    the output file."""
    if out_format == "mdpa":
        # the NodalData/ElementalData writer reprs values ("np.float32(0.0)"
        # under numpy>=2) and the reader can't parse those sections anyway;
        # keep only the gmsh tag keys, which feed the structural element path
        mesh.point_data.clear()
        for key in [k for k in mesh.cell_data if k not in ("gmsh:physical", "gmsh:geometrical")]:
            del mesh.cell_data[key]
    elif out_format == "h5m":
        # the writer still uses the pre-5.x dict-of-dicts cell_data API and
        # crashes on any cell_data at all
        mesh.cell_data.clear()
    elif out_format == "dolfin-xml":
        # cell_data goes to separate companion files a single-file download
        # can't deliver, and integer data crashes the writer under numpy>=2
        mesh.cell_data.clear()
    elif out_format == "gmsh":
        # the 4.1 writer's $Entities section needs the complete tag trio
        # (gmsh:dim_tags point data + gmsh:physical/gmsh:geometrical cell
        # data) and KeyErrors on a partial set — which is what re-reading a
        # gmsh file without physical groups produces; fall back to writing no
        # entity bookkeeping at all
        have_all = (
            "gmsh:dim_tags" in mesh.point_data
            and "gmsh:physical" in mesh.cell_data
            and "gmsh:geometrical" in mesh.cell_data
        )
        if not have_all:
            mesh.point_data.pop("gmsh:dim_tags", None)
            mesh.cell_data.pop("gmsh:physical", None)
            mesh.cell_data.pop("gmsh:geometrical", None)
    elif out_format == "medit":
        # the writer formats the first integer array it finds as its scalar
        # label column; multi-column int arrays (e.g. gmsh:dim_tags) crash it
        for key in [k for k, v in mesh.point_data.items()
                    if v.ndim > 1 and np.issubdtype(v.dtype, np.integer)]:
            del mesh.point_data[key]
        for key in [k for k, blocks in mesh.cell_data.items()
                    if any(b.ndim > 1 and np.issubdtype(b.dtype, np.integer) for b in blocks)]:
            del mesh.cell_data[key]
    elif out_format == "xdmf":
        # the XML data path (forced by _write_kwargs) has no format strings
        # for sub-32-bit ints or float16 -> KeyError; upcast them
        def upcast(arr):
            if arr.dtype.kind in ("b", "i") and arr.dtype.itemsize < 4:
                return arr.astype(np.int32)
            if arr.dtype.kind == "u" and arr.dtype.itemsize < 4:
                return arr.astype(np.uint32)
            if arr.dtype.kind == "f" and arr.dtype.itemsize < 4:
                return arr.astype(np.float32)
            return arr

        for key, value in list(mesh.point_data.items()):
            mesh.point_data[key] = upcast(value)
        for key, blocks in list(mesh.cell_data.items()):
            mesh.cell_data[key] = [upcast(b) for b in blocks]


def convert_mesh(in_path, in_format, out_path, out_format):
    """Native -> native, straight through meshio. Reads the original file in
    its own format and writes the target format without collapsing to the
    app's triangle-only representation, so nothing is dropped except what the
    target format genuinely cannot store. Vertex normals/colors are renamed
    to the target's convention; everything else passes through as meshio
    read it (modulo the writer workarounds in _sanitize_for_target)."""
    try:
        mesh = meshio.read(in_path, in_format)
    except SystemExit:
        raise ValueError(f"Could not read file as {in_format or 'any known format'}")
    _normalize_arrays(mesh)
    _remap_attributes(mesh, out_format)
    _sanitize_for_target(mesh, out_format)
    meshio.write(out_path, mesh, file_format=out_format, **_write_kwargs(out_format))
    return json.dumps({"byteLength": os.path.getsize(out_path)})


def serialize_mesh(out_path, file_format, include_normals, include_colors):
    positions = np.fromfile(POSITIONS_F32, dtype=np.float32).reshape(-1, 3)
    indices = np.fromfile(INDICES_U32, dtype=np.uint32).reshape(-1, 3).astype(np.int32)

    point_data = {}
    if include_normals:
        normals = np.fromfile(NORMALS_F32, dtype=np.float32).reshape(-1, 3)
        _attach_normals(point_data, file_format, normals)
    if include_colors:
        colors = np.fromfile(COLORS_F32, dtype=np.float32).reshape(-1, 3)
        _attach_colors(point_data, file_format, colors)

    mesh = meshio.Mesh(positions, [("triangle", indices)], point_data=point_data)
    meshio.write(out_path, mesh, file_format=file_format, **_write_kwargs(file_format))
    return json.dumps({"byteLength": os.path.getsize(out_path)})
