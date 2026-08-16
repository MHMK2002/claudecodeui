import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Report Issue is hidden by null config and opens a consent-based preview when configured', async () => {
  const [manifest, button, sidebar] = await Promise.all([
    readFile('shared/product-config.json', 'utf8').then((source) => JSON.parse(source)),
    readFile('src/components/report-issue/ReportIssueButton.tsx', 'utf8'),
    readFile('src/components/sidebar/view/subcomponents/SidebarFooter.tsx', 'utf8'),
  ]);

  assert.equal(manifest.issueTrackerUrl, null);
  assert.match(button, /if \(!issueTrackerUrl\) return null/);
  assert.match(sidebar, /PRODUCT_CONFIG\.issueTrackerUrl &&/);
  assert.match(button, /Report Issue preview/);
  assert.match(button, /Include app version and OS/);
  assert.match(button, /Include redacted diagnostics/);
  assert.match(button, /variant="outline"[\s\S]*Copy diagnostics/);
  assert.match(button, /<Button type="button" className="min-h-11" onClick=\{openTracker\}>Open issue tracker<\/Button>/);
  assert.doesNotMatch(button, /<Button[^>]*className="[^"]*bg-primary[^"]*"[^>]*>\s*Copy diagnostics/);
});
