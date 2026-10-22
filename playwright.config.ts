import { defineConfig } from '@playwright/test';

// Use a dedicated port. Never reuse a server, because another checkout can serve different code.
const port = Number(process.env.KALKIDAN_UI_TEST_PORT || 5174);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  use: { baseURL, viewport: { width: 1360, height: 960 }, headless: true, colorScheme: 'light' },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
