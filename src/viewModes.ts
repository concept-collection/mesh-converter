export type ViewMode = 'shaded' | 'wire' | 'both' | 'points'

export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'shaded', label: 'Shaded' },
  { id: 'wire', label: 'Wire' },
  { id: 'both', label: 'Both' },
  { id: 'points', label: 'Points' },
]
