import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLocalStartupHtml, LOCAL_STARTUP_STEPS } from '../../electron/startupPage.js';

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('startup page exposes truthful stages and a single current stage', () => {
  const html = buildLocalStartupHtml('CloudCLI', 'Local CloudCLI', 'checking-compatibility');

  assert.match(html, /Getting your workspace ready/);
  assert.match(html, /Starting local server/);
  assert.match(html, /Checking compatibility/);
  assert.match(html, /Opening workspace/);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /class="step complete"/);
  assert.match(html, /class="step current" aria-current="step"/);
  assert.match(html, /class="step pending"/);
  assert.match(html, /role="progressbar"[^>]*aria-busy="true"/);
  assert.doesNotMatch(html, /Waiting for process output|<pre|startup-log/i);
});

test('startup page is safe for dynamic titles and reduced-motion users', () => {
  const html = buildLocalStartupHtml('<Cloud & CLI>', '<Local & private>', 'opening-workspace');

  assert.match(html, /&lt;Cloud &amp; CLI&gt;/);
  assert.match(html, /&lt;Local &amp; private&gt;/);
  assert.doesNotMatch(html, /<Cloud & CLI>/);
  assert.doesNotMatch(html, /<Local & private>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /animation:none/);
  assert.match(html, /@media\(max-width:640px\)/);
});

test('unknown startup stages recover to the first truthful stage', () => {
  const html = buildLocalStartupHtml('CloudCLI', 'Local CloudCLI', 'unexpected-stage');

  assert.match(html, /Starting local server/);
  assert.match(html, /class="step current" aria-current="step"/);
  assert.equal(LOCAL_STARTUP_STEPS.length, 3);
});

test('current-stage markers retain readable contrast in light and dark themes', () => {
  const html = buildLocalStartupHtml('CloudCLI', 'Local CloudCLI', 'starting-local-server');
  const lightVariables = html.match(/:root\{([^}]*)\}/)?.[1];
  const darkVariables = html.match(/prefers-color-scheme:dark\)\{:root\{([^}]*)\}/)?.[1];

  assert.ok(lightVariables);
  assert.ok(darkVariables);
  for (const variables of [lightVariables, darkVariables]) {
    const brand = variables.match(/--brand:(#[0-9a-f]{6})/i)?.[1];
    const foreground = variables.match(/--brand-contrast:(#[0-9a-f]{6})/i)?.[1];
    assert.ok(brand);
    assert.ok(foreground);
    assert.ok(contrastRatio(foreground, brand) >= 4.5);
  }
  assert.match(html, /\.step\.current \.step-marker\{[^}]*color:var\(--brand-contrast\)/);
});
