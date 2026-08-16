/**
 * Preserves an existing unsent draft when a historic prompt is reused.
 * The copied text is appended as a separate paragraph; neither transcript
 * history nor the user's current draft is silently replaced.
 */
export function mergeCopiedMessageIntoDraft(currentDraft: string, copiedMessage: string): string {
  if (!currentDraft.trim()) return copiedMessage;
  if (!copiedMessage.trim()) return currentDraft;
  return `${currentDraft.replace(/\s+$/, '')}\n\n${copiedMessage.replace(/^\s+/, '')}`;
}
