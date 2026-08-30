// Stage DM6 - the driver app's dark theme, ported verbatim from the agreed
// mockup (bongofleet-driver-app.html)'s :root custom properties and a
// handful of its other classes. Nothing here has a visual effect on its own
// - it's the source every later screen-rebuild stage imports colors/radii/
// spacing/type from. Colors/spacing/type only, no component logic.

export const colors = {
  bg: '#0B1220',
  pageBg: '#070C14',
  card: '#151E2E',
  card2: '#1B2637',
  line: '#25324A',
  lineSoft: '#1E2A3D',
  txt: '#EAF0F8',
  txt2: '#97A6BD',
  txt3: '#6B7C96',
  green: '#22C55E',
  green2: '#16A34A',
  greenSoft: 'rgba(34,197,94,.14)',
  amber: '#F59E0B',
  amberSoft: 'rgba(245,158,11,.14)',
  red: '#EF4444',
  redSoft: 'rgba(239,68,68,.14)',
  blue: '#3B82F6',
  blueSoft: 'rgba(59,130,246,.14)',
  violet: '#8B5CF6',
  violetSoft: 'rgba(139,92,246,.14)',
} as const;

// Mockup border-radius values, read directly off .card/.tile (16px),
// .pill (20px), .cta (14px), and .fc (20px - the mockup's filter chips,
// e.g. Lipa's amount-preset row). .fc is a full pill shape in the mockup,
// not the 10-12px this stage's own task spec guessed at - kept as its
// literal value rather than approximated.
export const radii = {
  card: 16,
  pill: 20,
  cta: 14,
  chip: 20,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
} as const;

export const type = {
  greeting: { fontSize: 19, fontWeight: '800' as const },
  cardTitle: { fontSize: 14, fontWeight: '750' as const },
  // Mockup's .csub has no explicit font-weight (font-size: 11.5px only);
  // 650 is taken from the cluster of similar micro-label classes the
  // mockup uses at this size (.t-l 600, .q-l 650, .flabel 700), not a
  // literal .csub value.
  label: { fontSize: 11.5, fontWeight: '650' as const },
  // Mockup's .st b (strip stat value): font-size 15px, font-weight 800 -
  // not 750 as this stage's own task spec approximated. .t-v (tile value)
  // is a distinct, larger stat style (19px/800) also matching the
  // "statValue" description but not folded in here since only one numeric
  // token was asked for.
  statValue: { fontSize: 15, fontWeight: '800' as const },
  bigNumber: { fontSize: 44, fontWeight: '850' as const },
} as const;
