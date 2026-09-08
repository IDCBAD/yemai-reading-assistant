import { defineConfig } from 'wxt';
import base from './wxt.config';

export default defineConfig({
  ...base,
  outDir: '.output-diagnostic',
  // A custom WXT mode otherwise selects React's development runtime.
  // Keep the diagnostic feature flag while measuring production behavior.
  vite: () => ({
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
    },
  }),
});
