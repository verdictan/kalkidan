import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // The app's Vite config fixes the dev server to port 5173. Storybook picks its own port.
  viteFinal: (viteConfig) => {
    if (viteConfig.server) viteConfig.server = { ...viteConfig.server, strictPort: false };
    return viteConfig;
  },
};

export default config;
