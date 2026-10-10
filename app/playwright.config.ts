import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5251',
    trace: 'retain-on-failure',
    // the title screen has been seen and dismissed (welcome.spec.ts starts afresh)
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:5251', localStorage: [{ name: 'kq-welcome-seen', value: '1' }] }] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // a touch screen (coarse pointer, so bigger controls): the layout checks only
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, grep: /layout/ },
  ],
  webServer: {
    // from the repository root, like the package scripts
    cwd: '..',
    command: 'pnpm exec vite --config app/vite.config.ts --port 5251 --strictPort',
    url: 'http://localhost:5251',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
