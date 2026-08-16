import { version } from '../../package.json';
import { classifyIssueTrackerUrl } from '../../shared/issue-tracker.js';

export type IssueTrackerKind = 'github' | 'gitlab';

export type IssueDraft = {
  summary: string;
  details: string;
  includeSystemInfo: boolean;
  includeDiagnostics: boolean;
  os?: string;
  diagnostics?: string;
};

const REDACTED = '[redacted]';

/** Remove local identity, filesystem, network, and credential material from issue data. */
export function redactIssueData(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?(?:\/[^\s]*)?/gi, REDACTED)
    .replace(/\bfile:\/\/\/[^\s)]+/gi, REDACTED)
    .replace(/(?:^|[\s"'`(])\/(?:Users|home)\/[^\s"'`),]+/gm, (match) => `${match[0]}${REDACTED}`)
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'`),]+/g, REDACTED)
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|token|secret|password|email|project(?:[-_ ]?name)?|local[-_ ]?url|project[-_ ]?path|path)\s*[=:]\s*)([^\s,;}]+)/gi, `$1${REDACTED}`)
    .replace(/([?&](?:token|key|secret|password|email)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

export function getIssueTrackerKind(issueTrackerUrl: string): IssueTrackerKind {
  const parsed = new URL(issueTrackerUrl);
  if (parsed.protocol !== 'https:') throw new Error('Issue tracker must use HTTPS.');
  const kind = classifyIssueTrackerUrl(parsed);
  if (kind) return kind;
  throw new Error('Issue tracker must be a GitHub or GitLab issue URL.');
}

function getNewIssueUrl(issueTrackerUrl: string, kind: IssueTrackerKind): URL {
  const url = new URL(issueTrackerUrl);
  url.search = '';
  url.hash = '';
  const trimmedPath = url.pathname.replace(/\/+$/, '');

  if (kind === 'github') {
    if (/\/issues\/new$/.test(trimmedPath)) url.pathname = trimmedPath;
    else if (/\/issues$/.test(trimmedPath)) url.pathname = `${trimmedPath}/new`;
    else url.pathname = `${trimmedPath}/issues/new`;
  } else if (/\/-\/issues\/new$/.test(trimmedPath)) {
    url.pathname = trimmedPath;
  } else if (/\/-\/issues$/.test(trimmedPath)) {
    url.pathname = `${trimmedPath}/new`;
  } else {
    url.pathname = `${trimmedPath}/-/issues/new`;
  }

  return url;
}

export function buildIssueBody(draft: IssueDraft): string {
  const sections = [draft.details.trim()];
  if (draft.includeSystemInfo) {
    sections.push(`App version: ${version}\nOS: ${draft.os || 'Not available'}`);
  }
  if (draft.includeDiagnostics && draft.diagnostics) {
    sections.push(`Diagnostics (opt-in):\n\n\`\`\`text\n${draft.diagnostics}\n\`\`\``);
  }
  return redactIssueData(sections.filter(Boolean).join('\n\n---\n\n'));
}

/** Build a prefilled new-issue URL for GitHub or GitLab without opening it. */
export function buildIssueTrackerUrl(issueTrackerUrl: string, draft: IssueDraft): string {
  const kind = getIssueTrackerKind(issueTrackerUrl);
  const url = getNewIssueUrl(issueTrackerUrl, kind);
  const title = redactIssueData(draft.summary.trim());
  const body = buildIssueBody(draft);

  if (kind === 'github') {
    if (title) url.searchParams.set('title', title);
    if (body) url.searchParams.set('body', body);
  } else {
    if (title) url.searchParams.set('issue[title]', title);
    if (body) url.searchParams.set('issue[description]', body);
  }
  return url.toString();
}

/** Collect only allow-listed runtime identity; local URLs and user/project data are never read. */
export async function collectIssueDiagnostics(): Promise<string> {
  const diagnostics: Record<string, unknown> = { clientVersion: version };
  try {
    const response = await fetch('/health', { headers: { Accept: 'application/json' } });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const health = await response.json() as Record<string, unknown>;
      diagnostics.server = {
        status: health.status,
        version: health.version,
        buildId: health.buildId,
        runtimeMode: health.runtimeMode,
      };
    } else {
      diagnostics.server = { status: `health-${response.status}` };
    }
  } catch {
    diagnostics.server = { status: 'unavailable' };
  }
  return redactIssueData(JSON.stringify(diagnostics, null, 2));
}
