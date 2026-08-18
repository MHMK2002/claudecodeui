import type { AgentProvider } from '../../../types/types';
import type { ProviderAuthStatusMap } from '../../../../provider-auth/types';

/**
 * Resolves the initial Agents Settings tab without overwriting a deliberate
 * user choice. Claude remains the neutral default for zero or multiple
 * authenticated providers; a sole settled provider gets the first-run focus.
 */
export function resolveInitialAgentSelection(
  statuses: ProviderAuthStatusMap,
  current: AgentProvider,
  hasManualSelection: boolean,
): AgentProvider {
  if (hasManualSelection || Object.values(statuses).some((status) => status.loading)) {
    return current;
  }

  const authenticated = (Object.entries(statuses) as Array<[AgentProvider, ProviderAuthStatusMap[AgentProvider]]>)
    .filter(([, status]) => status.authenticated)
    .map(([provider]) => provider);
  return authenticated.length === 1 ? authenticated[0] : 'claude';
}
