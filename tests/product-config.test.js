import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { productConfig } from '../shared/product-config.js';

test('default product manifest disables commercial and cloud surfaces', () => {
  assert.deepEqual(productConfig.features, { cloud: false, hosted: false, pro: false });
  assert.equal(productConfig.issueTrackerUrl, null);
});

test('package metadata follows the shared manifest', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.productName, productConfig.productName);
  assert.equal(packageJson.build.productName, productConfig.productName);
  assert.equal(packageJson.homepage, productConfig.homepageUrl);
  assert.equal(packageJson.repository.url, productConfig.repositoryUrl);
  assert.equal(packageJson.bugs, undefined);
});

test('release metadata uses the canonical GitHub repository', () => {
  assert.equal(productConfig.repositoryUrl, 'https://github.com/MHMK2002/claudecodeui');
  assert.equal(
    productConfig.updateFeedUrl,
    'https://api.github.com/repos/MHMK2002/claudecodeui/releases/latest',
  );
});
