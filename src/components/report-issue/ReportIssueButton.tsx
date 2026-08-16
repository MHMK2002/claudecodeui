import { useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { PRODUCT_CONFIG } from '../../constants/config';
import {
  buildIssueBody,
  buildIssueTrackerUrl,
  collectIssueDiagnostics,
} from '../../lib/reportIssue';
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, Input } from '../../shared/view/ui';

type ReportIssueButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  label: string;
  /** Optional Storybook/test override; production uses the central product manifest. */
  issueTrackerUrl?: string | null;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

export default function ReportIssueButton({
  children,
  label,
  className,
  issueTrackerUrl: issueTrackerUrlOverride,
  ...buttonProps
}: ReportIssueButtonProps) {
  const issueTrackerUrl = issueTrackerUrlOverride === undefined
    ? PRODUCT_CONFIG.issueTrackerUrl
    : issueTrackerUrlOverride;
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [includeSystemInfo, setIncludeSystemInfo] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState('');
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const draft = useMemo(() => ({
    summary,
    details,
    includeSystemInfo,
    includeDiagnostics,
    os: includeSystemInfo
      ? (navigator as NavigatorWithUserAgentData).userAgentData?.platform || navigator.platform || 'Not available'
      : undefined,
    diagnostics,
  }), [details, diagnostics, includeDiagnostics, includeSystemInfo, summary]);

  if (!issueTrackerUrl) return null;

  const toggleDiagnostics = async (checked: boolean) => {
    setIncludeDiagnostics(checked);
    setCopyStatus('idle');
    if (!checked || diagnosticsStatus === 'ready') return;
    setDiagnosticsStatus('loading');
    try {
      setDiagnostics(await collectIssueDiagnostics());
      setDiagnosticsStatus('ready');
    } catch {
      setDiagnosticsStatus('failed');
    }
  };

  const copyDiagnostics = async () => {
    if (!includeDiagnostics || diagnosticsStatus !== 'ready') return;
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  const openTracker = () => {
    const issueUrl = buildIssueTrackerUrl(issueTrackerUrl, draft);
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={className} aria-label={buttonProps['aria-label'] || label} {...buttonProps}>
        {children}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6" aria-labelledby="report-issue-title">
        <DialogTitle id="report-issue-title" className="not-sr-only text-lg font-semibold text-foreground">
          Report Issue preview
        </DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Review exactly what will be prefilled before opening the external tracker.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1.5 text-sm font-medium text-foreground">
            Summary
            <Input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What went wrong?" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-foreground">
            Details
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Steps, expected result, and actual result"
            />
          </label>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">Optional prefill</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input type="checkbox" checked={includeSystemInfo} onChange={(event) => setIncludeSystemInfo(event.target.checked)} />
              Include app version and OS
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeDiagnostics}
                onChange={(event) => void toggleDiagnostics(event.target.checked)}
              />
              Include redacted diagnostics
            </label>
            {diagnosticsStatus === 'loading' && <p role="status" className="text-sm text-muted-foreground">Collecting diagnostics…</p>}
            {diagnosticsStatus === 'failed' && (
              <button type="button" className="min-h-11 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void toggleDiagnostics(true)}>
                Diagnostics failed — Retry
              </button>
            )}
          </fieldset>

          <div className="rounded-lg border border-border bg-muted p-3">
            <h3 className="text-sm font-medium text-foreground">Issue body preview</h3>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{buildIssueBody(draft) || 'No prefilled body yet.'}</pre>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={!includeDiagnostics || diagnosticsStatus !== 'ready'}
              onClick={() => void copyDiagnostics()}
            >
              Copy diagnostics
            </Button>
            {!includeDiagnostics && <p className="mt-1 text-xs text-muted-foreground">Enable diagnostics above to copy them.</p>}
            {copyStatus === 'copied' && <p role="status" className="mt-1 text-xs text-foreground">Diagnostics copied.</p>}
            {copyStatus === 'failed' && <p role="alert" className="mt-1 text-xs text-destructive">Copy failed. Try again.</p>}
          </div>
          <Button type="button" className="min-h-11" onClick={openTracker}>Open issue tracker</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
