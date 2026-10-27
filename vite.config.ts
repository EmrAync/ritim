import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: works on GitHub Pages under /<repo>/ and locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020' },
  test: { environment: 'node' },
} as never);
