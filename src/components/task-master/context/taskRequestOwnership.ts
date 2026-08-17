/**
 * Confirms that an asynchronous task request still owns both the latest
 * request generation and the project currently selected by the user.
 */
export function hasTaskProjectChanged(
  currentProjectId: string | null,
  nextProjectId: string | null,
): boolean {
  return currentProjectId !== nextProjectId;
}

export function ownsTaskRequest(
  requestSequence: number,
  currentSequence: number,
  requestProjectId: string,
  currentProjectId: string | null,
): boolean {
  return requestSequence === currentSequence && requestProjectId === currentProjectId;
}
