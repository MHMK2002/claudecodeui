import type { RefObject } from 'react';
import { Key, Loader2 } from 'lucide-react';

import { Button, Input } from '../../../shared/view/ui';
import type { GithubTokenCredential, TokenMode } from '../types';

type GithubAuthenticationCardProps = {
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GithubTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  focusRef?: RefObject<HTMLDivElement>;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
};

export default function GithubAuthenticationCard({
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  focusRef,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
}: GithubAuthenticationCardProps) {
  const hasStoredCredentials = availableTokens.length > 0;

  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      aria-labelledby="repository-credential-title"
      className="rounded-lg border border-border bg-muted/40 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="mb-3 flex items-start gap-3">
        <Key className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h4 id="repository-credential-title" className="font-medium text-foreground">
            Repository credential
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            The first clone attempt reported that authentication is required.
          </p>
        </div>
      </div>

      {loadingTokens && (
        <div className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading stored credentials…
        </div>
      )}

      {!loadingTokens && tokenLoadError && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          Stored credentials could not be loaded. You can enter one below.
        </p>
      )}

      {!loadingTokens && hasStoredCredentials && (
        <div className="mb-4 flex gap-2" role="group" aria-label="Credential source">
          <Button
            type="button"
            variant={tokenMode === 'stored' ? 'secondary' : 'outline'}
            className="min-h-11"
            onClick={() => onTokenModeChange('stored')}
            aria-pressed={tokenMode === 'stored'}
          >
            Stored credential
          </Button>
          <Button
            type="button"
            variant={tokenMode === 'new' ? 'secondary' : 'outline'}
            className="min-h-11"
            onClick={() => onTokenModeChange('new')}
            aria-pressed={tokenMode === 'new'}
          >
            Enter credential
          </Button>
        </div>
      )}

      {!loadingTokens && hasStoredCredentials && tokenMode === 'stored' ? (
        <div>
          <label htmlFor="stored-repository-credential" className="mb-2 block text-sm font-medium">
            Stored credential
          </label>
          <select
            id="stored-repository-credential"
            value={selectedGithubToken}
            onChange={(event) => onSelectedGithubTokenChange(event.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Choose a credential</option>
            {availableTokens.map((token) => (
              <option key={token.id} value={String(token.id)}>{token.credential_name}</option>
            ))}
          </select>
        </div>
      ) : !loadingTokens ? (
        <div>
          <label htmlFor="new-repository-credential" className="mb-2 block text-sm font-medium">
            Access token or password
          </label>
          <Input
            id="new-repository-credential"
            type="password"
            autoComplete="off"
            value={newGithubToken}
            onChange={(event) => {
              onNewGithubTokenChange(event.target.value);
              onTokenModeChange('new');
            }}
            placeholder="Enter credential"
            className="h-11"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Used only for this clone request; the value is never shown in progress or diagnostics.
          </p>
        </div>
      ) : null}
    </section>
  );
}
