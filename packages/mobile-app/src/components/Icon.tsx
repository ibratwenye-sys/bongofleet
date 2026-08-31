import Svg, { Path, Rect, Circle } from 'react-native-svg';

// Stage DM6 - paths ported verbatim from the mockup's own inline tab-bar
// SVGs (bongofleet-driver-app.html), each a 24x24 viewBox with
// stroke="currentColor" stroke-width="2" fill="none". The mockup's own tab
// icons don't set stroke-linecap="round" (only its masthead logo icon
// does), but round caps are used here anyway to match the rounded style
// the rest of the icon family (and the spec for this component) calls for
// - the sharp/mitered default would look out of place on paths like Leo's
// roof shape.
const PATHS = {
  leo: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
  mkataba: ['M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z', 'M9 12l2 2 4-4'],
  matumizi: ['M3 3v18h18', 'M8 16l3-4 3 2 4-6'],
  back: ['M15 5l-7 7 7 7'],
  // Stage DM9 - Mkataba wangu's appbar-right "view contract" icon (a tray
  // + download arrow), ported from the mockup's own screen-4 appbar SVG.
  contract: ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5M12 15V3'],
  // Stage DM10 - Matumizi's appbar close (X), ported from the mockup's own
  // screen-5 appbar SVG.
  close: ['M18 6L6 18M6 6l12 12'],
} as const;

// Stage DM8 - the mockup's appbar back icon uses stroke-width 2.2, not the
// tab icons' 2 - the one exception to the shared default. Stage DM10's
// close icon uses the same 2.2 (its own appbar icon in the mockup).
const STROKE_WIDTH: Partial<Record<IconName, number>> = { back: 2.2, close: 2.2 };

export type IconName =
  'leo' | 'lipa' | 'mkataba' | 'matumizi' | 'mimi' | 'back' | 'contract' | 'close' | 'camera';

export function Icon({ name, size = 21, color }: { name: IconName; size?: number; color: string }) {
  const strokeWidth = STROKE_WIDTH[name] ?? 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'lipa' && (
        <>
          <Rect
            x={2}
            y={6}
            width={20}
            height={12}
            rx={2.5}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={12} r={2.4} stroke={color} strokeWidth={2} />
        </>
      )}
      {name === 'mimi' && (
        <>
          <Circle cx={12} cy={8} r={3.4} stroke={color} strokeWidth={2} />
          <Path
            d="M5 20a7 7 0 0114 0"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name === 'camera' && (
        <>
          <Rect
            x={2}
            y={6}
            width={20}
            height={14}
            rx={2.5}
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={13} r={3.6} stroke={color} strokeWidth={1.8} />
          <Path
            d="M8 6l1.5-2h5L16 6"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name !== 'lipa' &&
        name !== 'mimi' &&
        name !== 'camera' &&
        PATHS[name].map((d) => (
          <Path
            key={d}
            d={d}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
    </Svg>
  );
}
