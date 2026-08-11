import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  // @bongofleet/shared-lib is a linked workspace package (symlinked, not a
  // registry install), so Vite treats it as project source and skips its
  // usual esbuild pre-bundling - but its dist/ output is plain CommonJS
  // (tsc's compiled form), and Rollup's own ESM-output build can't resolve
  // named imports from that without going through esbuild's CJS interop
  // first. Forcing it into optimizeDeps makes that interop happen for both
  // dev and build, the same way it already does for every ordinary
  // node_modules CJS dependency.
  optimizeDeps: {
    include: ['@bongofleet/shared-lib'],
  },
  build: {
    commonjsOptions: {
      include: [/shared-lib/, /node_modules/],
    },
  },
});
