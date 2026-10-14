import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the data story as its own self-contained HTML file.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-story', target: 'es2022', rollupOptions: { input: 'story.html' } },
});
