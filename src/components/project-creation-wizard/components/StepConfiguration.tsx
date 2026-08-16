import { useEffect, useRef } from 'react';

import { Input } from '../../../shared/view/ui';
import { buildCloneDestination } from '../utils/projectCreationWorkflow';
import type {
  GithubTokenCredential,
  ProjectCreationField,
  ProjectCreationMode,
  TokenMode,
} from '../types';
import GithubAuthenticationCard from './GithubAuthenticationCard';
import WorkspacePathField from './WorkspacePathField';

type StepConfigurationProps = {
  mode: ProjectCreationMode;
  folderPath: string;
  repositoryUrl: string;
  destinationRoot: string;
  credentialRequired: boolean;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GithubTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  isCreating: boolean;
  focusField: ProjectCreationField | null;
  browseRequestKey: number;
  onFolderPathChange: (path: string) => void;
  onRepositoryUrlChange: (url: string) => void;
  onDestinationRootChange: (path: string) => void;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
};

export default function StepConfiguration({
  mode,
  folderPath,
  repositoryUrl,
  destinationRoot,
  credentialRequired,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  isCreating,
  focusField,
  browseRequestKey,
  onFolderPathChange,
  onRepositoryUrlChange,
  onDestinationRootChange,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
}: StepConfigurationProps) {
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const destinationButtonRef = useRef<HTMLButtonElement>(null);
  const repositoryUrlRef = useRef<HTMLInputElement>(null);
  const credentialRef = useRef<HTMLDivElement>(null);
  const exactDestination = buildCloneDestination(destinationRoot, repositoryUrl);

  useEffect(() => {
    if (focusField === 'folder') folderButtonRef.current?.focus();
    if (focusField === 'destination') destinationButtonRef.current?.focus();
    if (focusField === 'repositoryUrl') repositoryUrlRef.current?.focus();
    if (focusField === 'credential') credentialRef.current?.focus();
  }, [focusField, credentialRequired]);

  if (mode === 'local') {
    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">Existing folder</label>
        <WorkspacePathField
          value={folderPath}
          label="Existing folder"
          buttonRef={folderButtonRef}
          browseRequestKey={focusField === 'folder' ? browseRequestKey : 0}
          disabled={isCreating}
          onChange={onFolderPathChange}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          The folder must already exist and be writable. No files will be created during registration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="repository-url" className="mb-2 block text-sm font-medium text-foreground">
          Repository URL
        </label>
        <Input
          ref={repositoryUrlRef}
          id="repository-url"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={repositoryUrl}
          onChange={(event) => onRepositoryUrlChange(event.target.value)}
          placeholder="https://github.com/owner/repository.git"
          className="h-11"
          disabled={isCreating}
        />
        <p className="mt-2 text-sm text-muted-foreground">HTTPS and SSH repository URLs are supported.</p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">Destination</label>
        <WorkspacePathField
          value={destinationRoot}
          label="Destination"
          allowCreateFolder
          buttonRef={destinationButtonRef}
          browseRequestKey={focusField === 'destination' ? browseRequestKey : 0}
          disabled={isCreating}
          onChange={onDestinationRootChange}
        />
        {exactDestination && (
          <p className="mt-2 break-all text-sm text-muted-foreground">
            Exact clone destination: <code className="text-foreground">{exactDestination}</code>
          </p>
        )}
      </div>

      {credentialRequired && (
        <GithubAuthenticationCard
          tokenMode={tokenMode}
          selectedGithubToken={selectedGithubToken}
          newGithubToken={newGithubToken}
          availableTokens={availableTokens}
          loadingTokens={loadingTokens}
          tokenLoadError={tokenLoadError}
          focusRef={credentialRef}
          onTokenModeChange={onTokenModeChange}
          onSelectedGithubTokenChange={onSelectedGithubTokenChange}
          onNewGithubTokenChange={onNewGithubTokenChange}
        />
      )}
    </div>
  );
}
