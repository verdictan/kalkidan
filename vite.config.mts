import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    // Other worktrees and coverage runs write files here. A change must not reload the app.
    watch: { ignored: ['**/.claude/**', '**/coverage/**'] },
  },
});
