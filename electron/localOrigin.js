export function isExactVerifiedOrigin(rawUrl, verifiedOrigin) {
  if (!verifiedOrigin) return false;
  try {
    return new URL(rawUrl).origin === new URL(verifiedOrigin).origin;
  } catch {
    return false;
  }
}
