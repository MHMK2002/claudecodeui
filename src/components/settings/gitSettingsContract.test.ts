import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

test('Git Settings exposes one polished global generator card with one primary Save', async () => {
  const [tab, hook] = await Promise.all([
    read('src/components/settings/view/tabs/git-settings/GitSettingsTab.tsx'),
    read('src/components/settings/hooks/useGitSettings.ts'),
  ]);

  assert.match(tab, /Commit message generator/);
  assert.match(tab, /Global · all projects/);
  assert.match(tab, /settings-commit-provider/);
  assert.match(tab, /settings-commit-profile/);
  assert.match(tab, /settings-commit-model/);
  assert.match(tab, /settings-commit-effort/);
  assert.match(tab, /settings-commit-base-prompt/);
  assert.match(tab, /Restore default/);
  assert.match(tab, /maxLength=\{settings\.basePromptMaxLength\}/);
  assert.match(tab, /Fixed safety rules always remain active/);
  assert.match(tab, /onClick=\{\(\) => void settings\.saveGitConfig\(\)\}/);
  assert.match(tab, /variant="outline"[\s\S]*settings\.restoreDefaultBasePrompt/);
  assert.doesNotMatch(tab, /bg-primary[^\n]*Restore default/);

  assert.match(hook, /JSON\.stringify\(\{ gitName, gitEmail, commitMessage \}\)/);
  assert.match(hook, /validateCommitMessageGeneratorSettings/);
});

test('Source Control asks the server for global settings and never sends a client selection', async () => {
  const hook = await read('src/components/git-panel/hooks/useCommitMessageSuggestion.ts');
  const requestBody = hook.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),\n\s*signal:/)?.[1] ?? '';
  assert.match(hook, /\/api\/user\/git-config/);
  assert.match(requestBody, /project: projectId/);
  assert.match(requestBody, /files:/);
  assert.doesNotMatch(requestBody, /selection/);
});
