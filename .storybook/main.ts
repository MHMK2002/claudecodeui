import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(viteConfig) {
    // The product-only identity plugin injects dist/sw.js after an app build;
    // Storybook has no service worker artifact and must not run that close hook.
    viteConfig.plugins = (viteConfig.plugins ?? []).filter((plugin) => {
      if (!plugin || Array.isArray(plugin)) return true;
      return plugin.name !== 'cloudcli-build-identity';
    });
    return viteConfig;
  },
};

export default config;
