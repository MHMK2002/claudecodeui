export {};

declare global {
  type DesktopUpdaterPhase =
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'not-available'
    | 'error'
    | 'installing';

  type DesktopUpdaterState = {
    enabled: boolean;
    phase: DesktopUpdaterPhase;
    currentVersion: string;
    buildId: string;
    checkedAt: string | null;
    release: {
      version: string;
      title: string;
      notes: string;
      publishedAt: string | null;
      releaseUrl: string;
    } | null;
    progress: {
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    } | null;
    error: {
      message: string;
      code: string | null;
      recoverable: boolean;
    } | null;
    disabledReason: string | null;
  };

  var __CLOUDCLI_BUILD_ID__: string;
  var __CLOUDCLI_VERSION__: string;

  interface Window {
    __ROUTER_BASENAME__?: string;
    cloudcliDesktopLocalSession?: {
      renew(): Promise<{ success: boolean }>;
    };
    cloudcliDesktopPdf?: {
      exportPdf(payload: {
        html: string;
        suggestedFilename: string;
      }): Promise<{ status: 'saved' | 'cancelled' }>;
    };
    cloudcliDesktopVoiceSecrets?: {
      get(): Promise<{ apiKey: string; sonioxApiKey: string }>;
      set(patch: Partial<{ apiKey: string; sonioxApiKey: string }>): Promise<{
        apiKey: string;
        sonioxApiKey: string;
      }>;
    };
    cloudcliDesktopUpdater?: {
      getState(): Promise<DesktopUpdaterState>;
      check(): Promise<DesktopUpdaterState>;
      restartAndInstall(): Promise<DesktopUpdaterState>;
      onStateChanged(callback: (state: DesktopUpdaterState) => void): () => void;
    };
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
