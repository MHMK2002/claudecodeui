import type { Preview } from '@storybook/react-vite';

import '../src/index.css';

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'error',
    },
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: 'hsl(44 22% 96%)' },
        { name: 'dark', value: 'hsl(0 0% 8%)' },
      ],
    },
    controls: { expanded: true },
  },
};

export default preview;
