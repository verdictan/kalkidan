import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  use: { viewport: { width: 1360, height: 960 }, headless: true, colorScheme: 'dark' },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
});
