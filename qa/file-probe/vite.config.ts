import { defineConfig } from 'vite';
export default defineConfig({
  root: 'qa/file-probe',
  base: './',
  publicDir: false,
  server: { host: '127.0.0.1', port: 4191, strictPort: true },
  preview: { host: '127.0.0.1', port: 4191, strictPort: true },
  build: { outDir: '../../.qa-dist/file-probe', emptyOutDir: true },
});
