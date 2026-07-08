# Runs inside Pyodide. Bridges meshio to the JS app.
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


def _extract_normals(mesh):
    pd = mesh.point_data
    if "obj:vn" in pd:  # wavefront obj
        vn = np.asarray(pd["obj:vn"], dtype=np.float32)
        if vn.ndim == 2 and vn.shape[1] >= 3:
            return vn[:, :3]
    if all(k in pd for k in ("nx", "ny", "nz")):  # ply convention
        return np.column_stack([pd["nx"], pd["ny"], pd["nz"]]).astype(np.float32)
    for key, value in pd.items():
        value = np.asarray(value)
        if key.lower() in ("normals", "normal") and value.ndim == 2 and value.shape[1] == 3:
            return value.astype(np.float32)
    return None


def _extract_colors(mesh):
    """Vertex colors as float32 rgb in [0, 1], or None."""
    pd = mesh.point_data
    if all(k in pd for k in ("red", "green", "blue")):  # ply convention
        rgb = np.column_stack([pd["red"], pd["green"], pd["blue"]])
        scale = 255.0 if np.issubdtype(rgb.dtype, np.integer) else 1.0
        return (rgb / scale).astype(np.float32)
    for key, value in pd.items():
        value = np.asarray(value)
        if key.lower() in ("rgb", "rgba", "colors", "color") and value.ndim == 2 and value.shape[1] >= 3:
            rgb = value[:, :3]
            if np.issubdtype(rgb.dtype, np.integer):
                return (rgb / 255.0).astype(np.float32)
            return rgb.astype(np.float32)
    return None


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
        and k.lower() not in ("normals", "normal", "rgb", "rgba", "colors", "color")
        # format-internal bookkeeping, not user data
        and not k.startswith(("gmsh:", "medit:"))
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


def serialize_mesh(out_path, file_format, include_normals, include_colors):
    positions = np.fromfile(POSITIONS_F32, dtype=np.float32).reshape(-1, 3)
    indices = np.fromfile(INDICES_U32, dtype=np.uint32).reshape(-1, 3).astype(np.int32)

    point_data = {}
    if include_normals:
        normals = np.fromfile(NORMALS_F32, dtype=np.float32).reshape(-1, 3)
        if file_format == "obj":
            point_data["obj:vn"] = normals
        elif file_format == "ply":
            point_data["nx"] = normals[:, 0]
            point_data["ny"] = normals[:, 1]
            point_data["nz"] = normals[:, 2]
        else:
            point_data["Normals"] = normals
    if include_colors:
        colors = np.fromfile(COLORS_F32, dtype=np.float32).reshape(-1, 3)
        if file_format == "ply":
            rgb = np.clip(np.round(colors * 255.0), 0, 255).astype(np.uint8)
            point_data["red"] = rgb[:, 0]
            point_data["green"] = rgb[:, 1]
            point_data["blue"] = rgb[:, 2]
        else:
            point_data["RGB"] = colors

    mesh = meshio.Mesh(positions, [("triangle", indices)], point_data=point_data)
    kwargs = {}
    if file_format == "stl":
        kwargs["binary"] = True  # meshio defaults STL to ASCII
    elif file_format == "xdmf":
        # default "HDF" puts the data in a companion .h5 file, which a
        # single-file download can't deliver; inline it in the XML instead
        kwargs["data_format"] = "XML"
    meshio.write(out_path, mesh, file_format=file_format, **kwargs)
    return json.dumps({"byteLength": os.path.getsize(out_path)})
