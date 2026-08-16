/** @typedef {'github' | 'gitlab'} IssueTrackerKind */

const GITHUB_HOSTS = new Set(['github.com']);
const GITLAB_HOSTS = new Set(['gitlab.com']);
const GITHUB_ISSUES_SUFFIX = /\/issues(?:\/new)?\/?$/;
const GITLAB_ISSUES_SUFFIX = /\/-\/issues(?:\/new)?\/?$/;

function hasProjectPath(pathname, marker, exactSegmentCount = null) {
  const projectPath = marker === null ? pathname : pathname.slice(0, marker);
  const segmentCount = projectPath.split('/').filter(Boolean).length;
  return exactSegmentCount === null ? segmentCount >= 2 : segmentCount === exactSegmentCount;
}

/**
 * Classifies only unambiguous GitHub/GitLab project tracker URLs.
 *
 * Self-hosted GitLab instances are supported through their canonical
 * `/-/issues` path. A hostname merely containing "gitlab" is intentionally
 * insufficient because lookalike domains must not receive issue data.
 *
 * @param {string | URL} value
 * @returns {IssueTrackerKind | null}
 */
export function classifyIssueTrackerUrl(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;

  const hostname = parsed.hostname.toLowerCase();
  const githubIssuesMatch = parsed.pathname.match(GITHUB_ISSUES_SUFFIX);
  const gitlabIssuesMatch = parsed.pathname.match(GITLAB_ISSUES_SUFFIX);
  if (
    GITHUB_HOSTS.has(hostname)
    && githubIssuesMatch
    && hasProjectPath(parsed.pathname, githubIssuesMatch.index ?? 0, 2)
  ) return 'github';
  if (
    GITLAB_HOSTS.has(hostname)
    && gitlabIssuesMatch
    && hasProjectPath(parsed.pathname, gitlabIssuesMatch.index ?? 0)
  ) return 'gitlab';
  if (gitlabIssuesMatch && hasProjectPath(parsed.pathname, gitlabIssuesMatch.index ?? 0)) {
    return 'gitlab';
  }
  return null;
}
