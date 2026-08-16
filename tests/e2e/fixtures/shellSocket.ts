import type { Page } from '@playwright/test';

export async function installShellSocketMock(
  page: Page,
  errorCode: 'CWD_UNAVAILABLE' | null = null,
): Promise<void> {
  await page.addInitScript(({ configuredError }) => {
    type CapturedSocket = { url: string; messages: Array<Record<string, unknown>> };
    const captured: CapturedSocket[] = [];
    Object.assign(window, { __shellSockets: captured });

    class MockWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private readonly capture: CapturedSocket;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.capture = { url: this.url, messages: [] };
        captured.push(this.capture);
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      send(raw: string) {
        const message = JSON.parse(raw) as Record<string, unknown>;
        this.capture.messages.push(message);
        if (!this.url.endsWith('/shell') || message.type !== 'init') return;
        const response = configuredError
          ? {
              type: 'error',
              code: configuredError,
              message: 'The registered project folder is unavailable. Restore or reopen the folder, then retry.',
              recovery: 'retry',
            }
          : {
              type: 'ready',
              mode: 'interactive-terminal',
              projectId: message.projectId,
              reconnected: false,
            };
        window.setTimeout(() => {
          const event = new MessageEvent('message', { data: JSON.stringify(response) });
          this.onmessage?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const event = new CloseEvent('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }

    Object.assign(window, { WebSocket: MockWebSocket });
  }, { configuredError: errorCode });
}
