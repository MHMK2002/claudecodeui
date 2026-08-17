import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseWorkflow = await readFile(
  new URL('../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const ciWorkflow = await readFile(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const desktopReleaseWorkflow = await readFile(
  new URL('../../.github/workflows/desktop-release.yml', import.meta.url),
  'utf8',
);
const desktopStageScript = await readFile(
  new URL('../../scripts/release/prepare-desktop-app.js', import.meta.url),
  'utf8',
);
const ciGateScript = await readFile(
  new URL('../../scripts/release/require-ci-success.mjs', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

test('release validates every publishing credential before release-it can mutate state', () => {
  const releaseItIndex = releaseWorkflow.indexOf('npx release-it');
  assert.notEqual(releaseItIndex, -1);
  const preflight = releaseWorkflow.slice(0, releaseItIndex);

  for (const secret of [
    'NPM_TOKEN',
    'MACOS_CSC_LINK',
    'MACOS_CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'WINDOWS_CSC_LINK',
    'WINDOWS_CSC_KEY_PASSWORD',
  ]) {
    assert.match(preflight, new RegExp(`secrets\\.${secret}\\b`), `${secret} must be preflighted`);
  }
});

test('release requires successful CI for the exact source SHA before release-it', () => {
  const releaseItIndex = releaseWorkflow.indexOf('npx release-it');
  assert.notEqual(releaseItIndex, -1);
  const preflight = releaseWorkflow.slice(0, releaseItIndex);

  assert.match(preflight, /require-ci-success\.mjs wait/);
  assert.match(preflight, /--expected-sha "\$GITHUB_SHA"/);
  assert.match(preflight, /--event push/);
});

test('CI dispatch identity is required only for manual gates while push and PR jobs bypass a skip', () => {
  assert.match(ciWorkflow, /workflow_dispatch:[\s\S]*expected_sha:[\s\S]*required: true[\s\S]*gate_id:[\s\S]*required: true/);
  assert.match(ciWorkflow, /run-name:.*CI gate.*inputs\.gate_id/);
  assert.match(ciWorkflow, /identity:[\s\S]*if: github\.event_name == 'workflow_dispatch'/);
  assert.match(ciWorkflow, /test "\$GITHUB_SHA" = "\$EXPECTED_SHA"/);

  const jobs = ['quality', 'server', 'frontend', 'desktop', 'e2e'];
  for (const [index, job] of jobs.entries()) {
    const start = ciWorkflow.indexOf(`  ${job}:`);
    assert.notEqual(start, -1, `${job} job must exist`);
    const nextJob = index + 1 < jobs.length
      ? ciWorkflow.indexOf(`  ${jobs[index + 1]}:`, start + 3)
      : -1;
    const body = ciWorkflow.slice(start, nextJob === -1 ? undefined : nextJob);
    assert.match(body, /needs: identity/);
    assert.match(body, /needs\.identity\.result == 'success' \|\| needs\.identity\.result == 'skipped'/);
  }
});

test('release gates the final release SHA before dispatching pinned desktop builds', () => {
  const releaseIt = releaseWorkflow.indexOf('npx release-it');
  const finalSha = releaseWorkflow.indexOf('FINAL_SHA="$(git rev-parse');
  const remoteIdentity = releaseWorkflow.indexOf('name: Verify remote release identity');
  const finalCi = releaseWorkflow.indexOf('require-ci-success.mjs dispatch-and-wait');
  const finalRefetch = releaseWorkflow.lastIndexOf('refs/release-gates/final/');
  const desktopDispatch = releaseWorkflow.indexOf('gh workflow run desktop-release.yml');

  assert.ok(releaseIt < finalSha && finalSha < remoteIdentity && remoteIdentity < finalCi);
  assert.ok(finalCi < finalRefetch && finalRefetch < desktopDispatch);
  assert.match(releaseWorkflow, /--ref "\$RELEASE_TAG"[\s\S]*--expected-sha "\$FINAL_SHA"[\s\S]*--gate-id "\$GATE_ID"/);
  assert.match(releaseWorkflow, /gh workflow run desktop-release\.yml[\s\S]*--ref "\$RELEASE_TAG"[\s\S]*-f "expected_sha=\$FINAL_SHA"/);
});

test('Desktop Release pins both entry paths and revalidates after a bounded CI wait', () => {
  assert.match(desktopReleaseWorkflow, /workflow_dispatch:[\s\S]*expected_sha:[\s\S]*required: true/);
  assert.match(desktopReleaseWorkflow, /permissions:[\s\S]*actions: read[\s\S]*contents: read/);
  assert.match(desktopReleaseWorkflow, /DISPATCH_EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/);
  assert.match(desktopReleaseWorkflow, /PINNED_SHA="\$DISPATCH_EXPECTED_SHA"/);
  assert.match(desktopReleaseWorkflow, /PINNED_SHA="\$\(git rev-parse "\$GITHUB_SHA\^\{commit\}"\)"/);
  assert.match(desktopReleaseWorkflow, /SHA="\$\(git rev-parse "refs\/release-gates\/desktop\/\$TAG\^\{commit\}"\)"/);
  assert.match(desktopReleaseWorkflow, /if \[ "\$SHA" != "\$PINNED_SHA" \]/);

  const resolveTag = desktopReleaseWorkflow.indexOf('SHA="$(git rev-parse');
  const wait = desktopReleaseWorkflow.indexOf('require-ci-success.mjs wait');
  const revalidate = desktopReleaseWorkflow.indexOf('name: Revalidate release identity immediately before native builds');
  const matrix = desktopReleaseWorkflow.indexOf('strategy:');
  assert.ok(resolveTag < wait && wait < revalidate && revalidate < matrix);

  const checkoutRefs = [...desktopReleaseWorkflow.matchAll(/uses: actions\/checkout@[\s\S]*?with:\n([\s\S]*?)(?=\n\s+- name:|\n\s+- uses:)/g)]
    .map((match) => match[1]);
  assert.ok(checkoutRefs.length >= 4);
  assert.match(checkoutRefs[0], /ref: \$\{\{ inputs\.expected_sha \|\| github\.sha \}\}/);
  for (const checkout of checkoutRefs.slice(1)) {
    assert.match(checkout, /ref: \$\{\{ needs\.resolve\.outputs\.sha \}\}/);
  }
});

test('internal Desktop releases preserve production signing gates and publish trust material', () => {
  assert.match(desktopReleaseWorkflow, /release_mode:[\s\S]*type: choice[\s\S]*- production[\s\S]*- internal/);
  assert.match(desktopReleaseWorkflow, /DEFAULT_RELEASE_MODE: \$\{\{ vars\.DESKTOP_RELEASE_MODE \}\}/);
  assert.match(desktopReleaseWorkflow, /RELEASE_MODE="\$\{DISPATCH_RELEASE_MODE:-\$\{DEFAULT_RELEASE_MODE:-production\}\}"/);
  assert.match(desktopReleaseWorkflow, /release_mode=\$RELEASE_MODE/);
  assert.match(desktopReleaseWorkflow, /CLOUDCLI_RELEASE_MODE: \$\{\{ needs\.resolve\.outputs\.release_mode \}\}/);

  assert.match(desktopReleaseWorkflow, /Require macOS signing credentials[\s\S]*test -n "\$CSC_LINK"[\s\S]*if \[ "\$RELEASE_MODE" = "production" \]/);
  assert.match(
    desktopReleaseWorkflow,
    /Trust internal macOS signing certificate[\s\S]*sudo security add-trusted-cert -d -r trustRoot -p codeSign[\s\S]*\/Library\/Keychains\/System\.keychain/,
  );
  const internalMacTrustStep = desktopReleaseWorkflow.match(
    /- name: Trust internal macOS signing certificate[\s\S]*?(?=\n {6}- name:)/,
  );
  assert.ok(internalMacTrustStep);
  assert.match(internalMacTrustStep[0], /openssl pkcs12 -in/);
  assert.doesNotMatch(internalMacTrustStep[0], /openssl pkcs12 -legacy/);
  assert.doesNotMatch(internalMacTrustStep[0], /login\.keychain-db/);
  assert.match(desktopReleaseWorkflow, /Trust internal Windows signing certificate/);
  assert.match(desktopReleaseWorkflow, /needs\.resolve\.outputs\.release_mode == 'internal'/);
  assert.match(desktopReleaseWorkflow, /Add internal trust certificates and installation guide/);
  assert.match(desktopReleaseWorkflow, /cloudcli-internal-macos\.cer/);
  assert.match(desktopReleaseWorkflow, /cloudcli-internal-windows\.cer/);
  assert.match(desktopReleaseWorkflow, /INTERNAL_DESKTOP_INSTALL\.md/);

  assert.match(desktopStageScript, /CLOUDCLI_RELEASE_MODE === 'internal'/);
  assert.match(desktopStageScript, /notarize: false/);
  assert.match(desktopStageScript, /identity: 'CloudCLI Internal'/);
  assert.match(releaseWorkflow, /-f "release_mode=production"/);
});

test('staged Desktop package exposes a portable executable name', () => {
  assert.equal(packageJson.build.executableName, 'cloudcli-desktop');
  assert.match(desktopStageScript, /executableName: packageJson\.build\.executableName/);
});

test('CI gate implementation never writes or embeds its token in output', () => {
  assert.doesNotMatch(ciGateScript, /(?:stdout|stderr|console\.(?:log|error))[^\n]*(?:token|authorization)/i);
  assert.match(ciGateScript, /GitHub API request failed with status/);
});
