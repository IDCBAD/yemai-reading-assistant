import base from './wxt.config';
import { defineConfig } from 'wxt';

// Separate output prevents concurrent development builds from replacing test artifacts.
export default defineConfig({ ...base, outDir: '.output/reading-v2' });
