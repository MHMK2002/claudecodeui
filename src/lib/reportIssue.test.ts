import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIssueBody,
  buildIssueTrackerUrl,
  getIssueTrackerKind,
  redactIssueData,
} from './reportIssue';

test('buildIssueTrackerUrl creates a GitHub new issue preview', () => {
  const url = new URL(buildIssueTrackerUrl('https://github.com/acme/app/issues', {
    summary: 'Launcher fails',
    details: 'Retry stays visible.',
    includeSystemInfo: false,
    includeDiagnostics: false,
  }));

  assert.equal(url.origin + url.pathname, 'https://github.com/acme/app/issues/new');
  assert.equal(url.searchParams.get('title'), 'Launcher fails');
  assert.equal(url.searchParams.get('body'), 'Retry stays visible.');
});

test('buildIssueTrackerUrl creates a GitLab new issue preview', () => {
  const url = new URL(buildIssueTrackerUrl('https://gitlab.com/acme/app/-/issues', {
    summary: 'Shell disconnected',
    details: 'Reconnect did not recover.',
    includeSystemInfo: false,
    includeDiagnostics: false,
  }));

  assert.equal(url.origin + url.pathname, 'https://gitlab.com/acme/app/-/issues/new');
  assert.equal(url.searchParams.get('issue[title]'), 'Shell disconnected');
  assert.equal(url.searchParams.get('issue[description]'), 'Reconnect did not recover.');
});

test('buildIssueTrackerUrl supports a self-hosted GitLab canonical tracker path', () => {
  const url = new URL(buildIssueTrackerUrl('https://code.example.com/acme/app/-/issues', {
    summary: 'Schedule missed',
    details: 'The local server was running.',
    includeSystemInfo: false,
    includeDiagnostics: false,
  }));

  assert.equal(url.origin + url.pathname, 'https://code.example.com/acme/app/-/issues/new');
  assert.equal(url.searchParams.get('issue[title]'), 'Schedule missed');
});

test('redactIssueData removes local identity, URLs, paths, and secrets', () => {
  const redacted = redactIssueData([
    'person@example.com',
    'http://localhost:3001/project/private',
    '/Users/person/work/private-project',
    'C:\\Users\\person\\work\\private-project',
    'projectName=private-project',
    'token=top-secret',
    'Authorization: Bearer abc.def.ghi',
  ].join('\n'));

  assert.doesNotMatch(redacted, /person@example\.com|localhost:3001|\/Users\/person|C:\\Users\\person|private-project|top-secret|abc\.def\.ghi/);
});

test('getIssueTrackerKind rejects unsupported trackers and insecure URLs', () => {
  assert.throws(() => getIssueTrackerKind('https://example.com/issues'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('https://evilgitlab.example/acme/app/issues'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('https://gitlab.com/only-owner'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('https://github.com/only-owner'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('https://github.com/acme/app/pulls'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('https://gitlab.com/acme/app/-/merge_requests'), /GitHub or GitLab/);
  assert.throws(() => getIssueTrackerKind('http://github.com/acme/app/issues'), /HTTPS/);
});

test('system identity and diagnostics remain independent explicit opt-ins', () => {
  const privateByDefault = buildIssueBody({
    summary: 'Local issue',
    details: 'The action failed.',
    includeSystemInfo: false,
    includeDiagnostics: false,
    os: 'SecretOS',
    diagnostics: 'buildId: private-diagnostic',
  });
  assert.doesNotMatch(privateByDefault, /App version|SecretOS|private-diagnostic/);

  const systemOnly = buildIssueBody({
    summary: 'Local issue',
    details: 'The action failed.',
    includeSystemInfo: true,
    includeDiagnostics: false,
    os: 'TestOS',
    diagnostics: 'must-not-leak',
  });
  assert.match(systemOnly, /App version: .*\nOS: TestOS/);
  assert.doesNotMatch(systemOnly, /must-not-leak/);
});
