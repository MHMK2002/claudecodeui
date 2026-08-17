import { useEffect, useRef, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AuthProvider } from '../../auth/context/AuthContext';

import DesktopFirstRunSetup from './DesktopFirstRunSetup';

const catalog = {
  providers: [
    {
      provider: 'claude',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'Claude is not connected.',
      profiles: [],
      models: { DEFAULT: 'claude-sonnet', OPTIONS: [{ value: 'claude-sonnet', label: 'Claude Sonnet' }] },
    },
    {
      provider: 'codex',
      available: true,
      connectionAvailable: true,
      unavailableReason: null,
      profiles: [],
      models: { DEFAULT: 'gpt-5', OPTIONS: [{ value: 'gpt-5', label: 'GPT-5' }] },
    },
    {
      provider: 'cursor',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'Cursor is not connected.',
      profiles: [],
      models: { DEFAULT: 'auto', OPTIONS: [{ value: 'auto', label: 'Auto' }] },
    },
    {
      provider: 'opencode',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'OpenCode is not connected.',
      profiles: [],
      models: { DEFAULT: 'auto', OPTIONS: [{ value: 'auto', label: 'Auto' }] },
    },
  ],
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function DesktopStoryEnvironment({ children }: { children: ReactNode }) {
  const originalFetch = useRef(window.fetch);
  const originalLocalSession = useRef(window.cloudcliDesktopLocalSession);
  const originalVoiceSecrets = useRef(window.cloudcliDesktopVoiceSecrets);
  const voiceSecrets = useRef({ apiKey: '', sonioxApiKey: '' });

  window.cloudcliDesktopLocalSession = { renew: async () => ({ success: true }) };
  window.cloudcliDesktopVoiceSecrets = {
    get: async () => ({ ...voiceSecrets.current }),
    set: async (patch) => {
      voiceSecrets.current = { ...voiceSecrets.current, ...patch };
      return { ...voiceSecrets.current };
    },
  };
  window.fetch = async (input) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/auth/status') return json({ runtimeMode: 'desktop-local', needsSetup: false });
    if (path === '/api/auth/user') {
      return json({ user: { id: 1, username: '__cloudcli_desktop_local__', internal: true } });
    }
    if (path === '/api/user/onboarding-status') {
      return json({ success: true, hasCompletedOnboarding: false });
    }
    if (path === '/api/providers/selection-catalog') {
      return json({ success: true, data: catalog });
    }
    return json({ success: true, data: {} });
  };

  useEffect(() => () => {
    window.fetch = originalFetch.current;
    window.cloudcliDesktopLocalSession = originalLocalSession.current;
    window.cloudcliDesktopVoiceSecrets = originalVoiceSecrets.current;
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}

const meta = {
  title: 'Desktop UX/Onboarding/First-run setup',
  component: DesktopFirstRunSetup,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <DesktopStoryEnvironment>
        <div className="min-h-screen bg-background">
          <Story />
        </div>
      </DesktopStoryEnvironment>
    ),
  ],
} satisfies Meta<typeof DesktopFirstRunSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProviderStep: Story = {};
