import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyIssueTrackerUrl } from '../shared/issue-tracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'shared', 'product-config.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid product configuration: ${message}`);
}

function validatePublicUrl(key, value, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assert(typeof value === 'string' && value.trim() === value && value.length > 0, `${key} must be a non-empty URL or the allowed null value.`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid product configuration: ${key} is not a URL.`);
  }

  assert(parsed.protocol === 'https:', `${key} must use HTTPS.`);
  assert(!parsed.username && !parsed.password, `${key} must not include credentials.`);
  assert(!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), `${key} must be a public URL.`);
}

assert(typeof manifest.productName === 'string' && manifest.productName.trim().length > 0, 'productName is required.');
validatePublicUrl('homepageUrl', manifest.homepageUrl);
validatePublicUrl('repositoryUrl', manifest.repositoryUrl);
validatePublicUrl('issueTrackerUrl', manifest.issueTrackerUrl, { nullable: true });
if (manifest.issueTrackerUrl !== null) {
  assert(
    classifyIssueTrackerUrl(manifest.issueTrackerUrl) !== null,
    'issueTrackerUrl must point to a GitHub or GitLab project issue tracker.',
  );
}
validatePublicUrl('documentationUrl', manifest.documentationUrl);
validatePublicUrl('updateFeedUrl', manifest.updateFeedUrl);

assert(manifest.features && typeof manifest.features === 'object', 'features is required.');
for (const feature of ['cloud', 'hosted', 'pro']) {
  assert(typeof manifest.features[feature] === 'boolean', `features.${feature} must be boolean.`);
}

assert(packageJson.productName === manifest.productName, 'package.json productName must match the manifest.');
assert(packageJson.build?.productName === manifest.productName, 'package.json build.productName must match the manifest.');
assert(packageJson.homepage === manifest.homepageUrl, 'package.json homepage must match the manifest.');
assert(packageJson.repository?.url === manifest.repositoryUrl, 'package.json repository.url must match the manifest.');
if (manifest.issueTrackerUrl === null) {
  assert(packageJson.bugs == null, 'package.json bugs must be absent while issueTrackerUrl is null.');
} else {
  assert(packageJson.bugs?.url === manifest.issueTrackerUrl, 'package.json bugs.url must match the manifest.');
}

console.log(`Validated product configuration for ${manifest.productName}.`);
