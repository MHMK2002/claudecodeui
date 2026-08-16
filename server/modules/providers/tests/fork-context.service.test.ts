import assert from 'node:assert/strict';
import test from 'node:test';

import { createForkContextService } from '@/modules/providers/services/fork-context.service.js';

type FactoryDependencies = NonNullable<Parameters<typeof createForkContextService>[0]>;
type QueryFunction = NonNullable<FactoryDependencies['query']>;
type QueryInput = Parameters<QueryFunction>[0];

test('fork-context summarizer disables Claude SDK session persistence', async () => {
  const capturedInputs: QueryInput[] = [];
  const queryStub = ((input: QueryInput) => {
    capturedInputs.push(input);

    return (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Persist-free handoff summary.' }],
        },
      };
    })() as unknown as ReturnType<QueryFunction>;
  }) as QueryFunction;
  const service = createForkContextService({ query: queryStub });

  const summary = await service.buildForkContext({
    messages: [{
      id: 'message-1',
      sessionId: 'source-session',
      timestamp: '2026-08-16T00:00:00.000Z',
      provider: 'codex',
      kind: 'text',
      role: 'user',
      content: 'Continue the provider-switch investigation.',
    }],
    sourceProvider: 'codex',
    sourceProviderProfileId: null,
    projectPath: null,
    userId: null,
  });

  assert.equal(summary, 'Persist-free handoff summary.');
  assert.equal(capturedInputs.length, 1);
  assert.equal(capturedInputs[0]?.options?.persistSession, false);
});
