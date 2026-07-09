import type { MeshData, MeshCapabilities } from './types'

/**
 * A real mesh format handled by meshio (id = meshio's file_format name).
 * `capabilities` declares which optional attributes this app preserves when
 * writing the format — it drives the loss warnings in the UI and which
 * point-data arrays the bridge attaches on export.
 */
export interface MeshFormat {
  id: string
  label: string
  /** File extension including the dot, e.g. ".ply" */
  extension: string
  blurb: string
  capabilities: MeshCapabilities
  /**
   * Prebuilt Pyodide packages this format needs (e.g. h5py). Loaded lazily on
   * first use so the default footprint stays small.
   */
  pyodidePackages?: string[]
}

export const formats: MeshFormat[] = [
  {
    id: 'ply',
    label: 'PLY (Polygon File Format)',
    extension: '.ply',
    blurb:
      'The Stanford scanner format, widely understood by mesh tools. Stores vertex ' +
      'normals (nx/ny/nz) and colors (red/green/blue) as standard vertex properties.',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'obj',
    label: 'Wavefront OBJ',
    extension: '.obj',
    blurb:
      'Ubiquitous text format from the graphics world. Carries vertex normals (vn lines) ' +
      'but has no standard slot for per-vertex colors.',
    capabilities: { normals: true, colors: false },
  },
  {
    id: 'stl',
    label: 'STL',
    extension: '.stl',
    blurb:
      'The 3D-printing staple: a bare triangle soup (written binary). Per-facet normals ' +
      'are kept when present (else recomputed); vertex normals and colors cannot be stored.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'off',
    label: 'OFF (Object File Format)',
    extension: '.off',
    blurb:
      'Minimal academic text format: vertex coordinates and triangle faces, nothing else ' +
      '(quad/color OFF variants are not supported by meshio).',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'vtk',
    label: 'VTK legacy',
    extension: '.vtk',
    blurb:
      'Legacy VTK unstructured grid. Normals and colors travel as named point-data ' +
      'arrays (Normals, RGB), visible in ParaView.',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'vtu',
    label: 'VTU (VTK XML)',
    extension: '.vtu',
    blurb:
      'Modern XML VTK unstructured grid with compressed binary data. Normals and colors ' +
      'travel as point-data arrays.',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'gmsh',
    label: 'Gmsh MSH',
    extension: '.msh',
    blurb:
      'Native format of the Gmsh mesh generator (v4.1 binary). Normals and colors travel ' +
      'as NodeData point-data arrays.',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'xdmf',
    label: 'XDMF',
    extension: '.xdmf',
    blurb:
      'XML metadata with HDF5-backed heavy data, common in HPC simulation. Normals and ' +
      'colors travel as point-data arrays. Loads the h5py package on first use.',
    capabilities: { normals: true, colors: true },
    pyodidePackages: ['h5py'],
  },
  {
    id: 'med',
    label: 'MED (Salome)',
    extension: '.med',
    blurb:
      'HDF5-based format of the Salome platform and code_aster. Normals and colors ' +
      'travel as point-data fields. Loads the h5py package on first use.',
    capabilities: { normals: true, colors: true },
    pyodidePackages: ['h5py'],
  },
  {
    id: 'h5m',
    label: 'H5M (MOAB)',
    extension: '.h5m',
    blurb:
      'HDF5-based format of the MOAB mesh library. Normals and colors travel as tags. ' +
      'Loads the h5py package on first use.',
    capabilities: { normals: true, colors: true },
    pyodidePackages: ['h5py'],
  },
  {
    id: 'avsucd',
    label: 'AVS-UCD',
    extension: '.avs',
    blurb:
      'AVS unstructured cell data, a classic visualization text format. Normals and ' +
      'colors travel as node data.',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'abaqus',
    label: 'Abaqus',
    extension: '.inp',
    blurb: 'Abaqus FEA input deck (text). Geometry only.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'nastran',
    label: 'Nastran',
    extension: '.bdf',
    blurb: 'Nastran bulk data file, widespread in structural analysis. Geometry only.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'medit',
    label: 'Medit',
    extension: '.mesh',
    blurb: 'Text format of the Medit/INRIA meshing tools (also used by mmg). Geometry only.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'netgen',
    label: 'Netgen',
    extension: '.vol',
    blurb: 'Native format of the Netgen mesh generator. Geometry only.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'mdpa',
    label: 'MDPA (Kratos)',
    extension: '.mdpa',
    blurb:
      'Input format of the Kratos multiphysics framework. Geometry only — meshio writes ' +
      'mesh data corruptly, so the app strips it to keep the file valid.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'tecplot',
    label: 'Tecplot',
    extension: '.dat',
    blurb:
      'Tecplot ASCII data format. Normals and colors travel as per-node variables ' +
      '(nx/ny/nz, red/green/blue).',
    capabilities: { normals: true, colors: true },
  },
  {
    id: 'dolfin-xml',
    label: 'DOLFIN XML',
    extension: '.xml',
    blurb: 'Legacy XML format of the FEniCS/DOLFIN project. Geometry only.',
    capabilities: { normals: false, colors: false },
  },
  {
    id: 'permas',
    label: 'PERMAS',
    extension: '.post',
    blurb: 'PERMAS FEA text format. Geometry only.',
    capabilities: { normals: false, colors: false },
  },
]

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
  return losses
}
