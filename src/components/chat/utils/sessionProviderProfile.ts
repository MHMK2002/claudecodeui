import type { ProjectSession } from '../../../types/app';

export function getSessionProviderProfileId(
  session: ProjectSession | null,
): number | null | undefined {
  if (!session) {
    return undefined;
  }

  return session.__providerProfileId !== undefined
    ? session.__providerProfileId
    : session.providerProfileId;
}
