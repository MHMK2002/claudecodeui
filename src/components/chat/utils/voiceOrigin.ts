export function buildVoiceViewKey(
  sessionKey: string | null,
  provider: string,
  projectKey: string | null | undefined,
  unsavedNonce = 0,
): string {
  return sessionKey
    ? `session:${sessionKey}`
    : `new:${provider}:${projectKey || 'none'}:${unsavedNonce}`;
}

export function isBackgroundVoiceOrigin(originViewKey: string, activeViewKey: string): boolean {
  return originViewKey !== activeViewKey;
}
