import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import LocalSessionRecovery from './LocalSessionRecovery';

function DesktopSessionFixture(props: React.ComponentProps<typeof LocalSessionRecovery>) {
  const previous = useRef(window.cloudcliDesktopLocalSession);
  window.cloudcliDesktopLocalSession = { renew: async () => ({ success: true }) };
  useEffect(() => () => {
    window.cloudcliDesktopLocalSession = previous.current;
  }, []);
  return <LocalSessionRecovery {...props} />;
}

const meta = {
  title: 'Desktop UX/Auth/Local session recovery',
  component: LocalSessionRecovery,
  parameters: { layout: 'fullscreen' },
  args: {
    message: 'The local session expired while the Desktop app was restarting.',
    onRetry: async () => undefined,
  },
} satisfies Meta<typeof LocalSessionRecovery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowserHandoffRequired: Story = {};

export const DesktopCanReconnect: Story = {
  render: (args) => <DesktopSessionFixture {...args} />,
};
