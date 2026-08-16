import { Volume2, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useTts } from '../../hooks/useTts';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';

// Tap-to-speak button beside the copy control on assistant messages.
// Renders nothing unless the optional voice feature is enabled.
const MessageSpeakControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const available = useVoiceAvailable();
  const { preferences } = useUiPreferences();
  const { state, toggle, error } = useTts(() => content);

  if (!available || !preferences.voiceReadAloud) return null;

  const title =
    state === 'playing' ? t('voice.stopSpeaking') : state === 'loading' ? t('voice.loading') : t('voice.speak');

  return (
    <span className="relative inline-flex">
      {error && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 max-w-[240px] -translate-x-1/2 whitespace-normal rounded bg-red-600 px-2 py-1 text-center text-xs text-white shadow-lg">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {state === 'playing' ? (
          <Square className="h-3.5 w-3.5" />
        ) : state === 'loading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
};

export default MessageSpeakControl;
