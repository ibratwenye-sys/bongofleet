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
  // Stage DM11 - Mimi's screen-6 icons, ported verbatim from the mockup.
  chevron: ['M9 6l6 6-6 6'],
  // Same shape as `mkataba`'s first path (the mockup reuses this outline
  // for both the tab-bar contract icon and Mimi's insurance row) - kept as
  // its own named icon per the task spec rather than overloading `mkataba`
  // outside a tab-bar context.
  shield: ['M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z'],
  // The Mkataba wangu row inside Mimi's documents card - a plain document
  // glyph, distinct from the tray+download `contract` icon used on Mkataba
  // wangu's own appbar action.
  contractfile: ['M6 2h9l5 5v15H6z', 'M15 2v5h5'],
  bell: ['M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9z'],
  // The mockup's own glyph here is literally three horizontal lines, not a
  // globe - ported as-is.
  language: ['M5 8h14M5 12h14M5 16h9'],
  logout: ['M15 17l5-5-5-5', 'M20 12H9', 'M12 3H5v18h7'],
  // Stage DM13 - Today screen's "Thibitisha kufika" confirm button, ported
  // from the mockup's own inline check-glyph on that button.
  check: ['M5 12l5 5L20 7'],
} as const;

// Stage DM8 - the mockup's appbar back icon uses stroke-width 2.2, not the
// tab icons' 2 - the one exception to the shared default. Stage DM10's
// close icon uses the same 2.2 (its own appbar icon in the mockup). Stage
// DM13's check icon (Today screen's confirm button) uses 2.4, per its own
// mockup svg.
const STROKE_WIDTH: Partial<Record<IconName, number>> = { back: 2.2, close: 2.2, check: 2.4 };

export type IconName =
  | 'leo'
  | 'lipa'
  | 'mkataba'
  | 'matumizi'
  | 'mimi'
  | 'back'
  | 'contract'
  | 'close'
  | 'camera'
  | 'chevron'
  | 'settings'
  | 'idcard'
  | 'shield'
  | 'contractfile'
  | 'history'
  | 'bell'
  | 'language'
  | 'logout'
  | 'check'
  | 'truck';

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
      {name === 'settings' && (
        <>
          <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
          <Path
            d="M12 3v3M12 18v3M3 12h3M18 12h3"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name === 'idcard' && (
        <>
          <Rect
            x={3}
            y={5}
            width={18}
            height={14}
            rx={2}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={9} cy={11} r={2} stroke={color} strokeWidth={2} />
        </>
      )}
      {name === 'truck' && (
        <>
          <Rect
            x={1}
            y={7}
            width={13}
            height={9}
            rx={1.5}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M14 10h4l3 3v3h-7"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={6} cy={18} r={1.8} stroke={color} strokeWidth={2} />
          <Circle cx={18} cy={18} r={1.8} stroke={color} strokeWidth={2} />
        </>
      )}
      {name === 'history' && (
        <>
          <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
          <Path
            d="M12 7v5l3 2"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name !== 'lipa' &&
        name !== 'mimi' &&
        name !== 'camera' &&
        name !== 'settings' &&
        name !== 'idcard' &&
        name !== 'history' &&
        name !== 'truck' &&
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
