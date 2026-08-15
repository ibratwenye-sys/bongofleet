import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Stage H1 - @bongofleet/shared-lib used to be consumed as a compiled
// artifact: its package.json "main" points at dist/index.js (plain CJS from
// tsc), and the dashboard previously imported that dist build through Vite's
// dependency optimizer (optimizeDeps + commonjsOptions, for the CJS/ESM
// interop Rollup needs). That made "the dashboard's view of shared-lib" a
// *copy*, staged through a build step and a dep-optimizer cache with its own
// invalidation rules - and every one of those staging points has separately
// gone stale and shipped wrong behaviour (Stage F3c, Stage G, Stage G2,
// Stage G9). The fix is to stop staging it at all: alias the package
// specifier straight at its TypeScript source. Vite then compiles
// estimate-plan-term.ts etc. as first-party project code - same as any
// dashboard file, recompiled on save, no dist/, no optimizer cache to go
// stale. See packages/dashboard/tsconfig.json for the matching `paths` entry
// (needed so `tsc -b` resolves the same source, not dist/index.d.ts).
const sharedLibSrc = fileURLToPath(new URL('../shared-lib/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@bongofleet/shared-lib': sharedLibSrc,
    },
  },
});
