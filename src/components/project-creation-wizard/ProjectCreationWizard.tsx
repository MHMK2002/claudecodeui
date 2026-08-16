import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';

import ErrorBanner from './components/ErrorBanner';
import StepConfiguration from './components/StepConfiguration';
import StepModeSelection from './components/StepModeSelection';
import StepReview from './components/StepReview';
import WizardFooter from './components/WizardFooter';
import WizardProgress from './components/WizardProgress';
import { useGithubTokens } from './hooks/useGithubTokens';
import {
  cancelCloneAttempt,
  cloneWorkspaceWithProgress,
  createProjectRequest,
  ProjectCreationRequestError,
} from './data/workspaceApi';
import {
  buildCloneDestination,
  getProjectErrorPresentation,
  getProjectErrorRecoveryStep,
  getRepositoryName,
  shouldResetCredentialChallenge,
} from './utils/projectCreationWorkflow';
import type {
  CloneProgress,
  ProjectCreationErrorPresentation,
  ProjectCreationField,
  TokenMode,
  WizardFormState,
  WizardStep,
} from './types';

type ProjectCreationWizardProps = {
  onClose: () => void;
  onProjectCreated?: (project?: Record<string, unknown>) => void;
};

const initialFormState: WizardFormState = {
  mode: null,
  folderPath: '',
  repositoryUrl: '',
  destinationRoot: '',
  tokenMode: 'none',
  selectedGithubToken: '',
  newGithubToken: '',
};

function createAttemptId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ProjectCreationWizard({ onClose, onProjectCreated }: ProjectCreationWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [formState, setFormState] = useState<WizardFormState>(initialFormState);
  const [credentialRequired, setCredentialRequired] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationUnavailable, setCancellationUnavailable] = useState(false);
  const [error, setError] = useState<ProjectCreationErrorPresentation | null>(null);
  const [focusField, setFocusField] = useState<ProjectCreationField | null>(null);
  const [browseRequestKey, setBrowseRequestKey] = useState(0);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const activeAttemptRef = useRef<string | null>(null);

  const shouldLoadTokens = step === 2 && formState.mode === 'clone' && credentialRequired;
  const autoSelectToken = useCallback((tokenId: string) => {
    setFormState((previous) => ({
      ...previous,
      tokenMode: 'stored',
      selectedGithubToken: tokenId,
    }));
  }, []);
  const {
    tokens: availableTokens,
    loading: loadingTokens,
    loadError: tokenLoadError,
    selectedTokenName,
  } = useGithubTokens({
    shouldLoad: shouldLoadTokens,
    selectedTokenId: formState.selectedGithubToken,
    onAutoSelectToken: autoSelectToken,
  });

  useEffect(() => {
    if (!credentialRequired || loadingTokens || formState.tokenMode !== 'none') return;
    setFormState((previous) => ({
      ...previous,
      tokenMode: availableTokens.length > 0 ? 'stored' : 'new',
    }));
  }, [availableTokens.length, credentialRequired, formState.tokenMode, loadingTokens]);

  const destinationPath = useMemo(
    () => buildCloneDestination(formState.destinationRoot, formState.repositoryUrl),
    [formState.destinationRoot, formState.repositoryUrl],
  );

  const updateField = useCallback(<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => {
    setFormState((previous) => ({ ...previous, [key]: value }));
    setError(null);
    setFocusField(null);
  }, []);

  const handleRepositoryUrlChange = useCallback((repositoryUrl: string) => {
    const repositoryChanged = shouldResetCredentialChallenge(
      formState.repositoryUrl,
      repositoryUrl,
    );
    setFormState((previous) => ({
      ...previous,
      repositoryUrl,
      ...(repositoryChanged
        ? {
            tokenMode: 'none' as const,
            selectedGithubToken: '',
            newGithubToken: '',
          }
        : {}),
    }));
    if (repositoryChanged) setCredentialRequired(false);
    setError(null);
    setFocusField(null);
  }, [formState.repositoryUrl]);

  const showClientError = useCallback((
    code: string,
    message: string,
    field: ProjectCreationField,
  ) => {
    const presentation = getProjectErrorPresentation(code, message);
    setError({ ...presentation, field });
    setFocusField(field);
  }, []);

  const validateConfiguration = useCallback((): boolean => {
    if (formState.mode === 'local') {
      if (!formState.folderPath.trim()) {
        showClientError('INVALID_PROJECT_PATH', 'Choose the existing project folder.', 'folder');
        return false;
      }
      return true;
    }
    if (!getRepositoryName(formState.repositoryUrl)) {
      showClientError('INVALID_REPOSITORY_URL', 'Enter a valid repository URL.', 'repositoryUrl');
      return false;
    }
    if (!formState.destinationRoot.trim() || !destinationPath) {
      showClientError('INVALID_PROJECT_PATH', 'Choose the parent destination folder.', 'destination');
      return false;
    }
    if (credentialRequired) {
      const missingStored = formState.tokenMode === 'stored' && !formState.selectedGithubToken;
      const missingNew = formState.tokenMode === 'new' && !formState.newGithubToken.trim();
      if (formState.tokenMode === 'none' || missingStored || missingNew) {
        showClientError('AUTH_REQUIRED', 'Choose or enter a repository credential.', 'credential');
        return false;
      }
    }
    return true;
  }, [credentialRequired, destinationPath, formState, showClientError]);

  const handleAdvance = useCallback(() => {
    setError(null);
    setFocusField(null);
    if (step === 1) {
      if (!formState.mode) return;
      setStep(2);
      return;
    }
    if (step === 2 && validateConfiguration()) setStep(3);
  }, [formState.mode, step, validateConfiguration]);

  const handleBack = useCallback(() => {
    setError(null);
    setFocusField(null);
    setStep((previous) => Math.max(1, previous - 1) as WizardStep);
  }, []);

  const handleCreationError = useCallback((caughtError: unknown) => {
    const requestError = caughtError instanceof ProjectCreationRequestError
      ? caughtError
      : null;
    const presentation = getProjectErrorPresentation(
      requestError?.code || 'UNKNOWN',
      caughtError instanceof Error ? caughtError.message : undefined,
    );
    const resolvedError: ProjectCreationErrorPresentation = {
      ...presentation,
      action: requestError?.action as ProjectCreationErrorPresentation['action'] || presentation.action,
      field: requestError?.field as ProjectCreationField || presentation.field,
      attemptId: requestError?.attemptId,
    };
    setError(resolvedError);
    if (resolvedError.code === 'AUTH_REQUIRED') setCredentialRequired(true);
    const recoveryStep = getProjectErrorRecoveryStep(resolvedError.action);
    setStep(recoveryStep);
    setFocusField(recoveryStep === 2 ? resolvedError.field : null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!formState.mode || !validateConfiguration()) return;
    setIsCreating(true);
    setIsCancelling(false);
    setCancellationUnavailable(false);
    setError(null);
    setCloneProgress(null);

    try {
      if (formState.mode === 'local') {
        const project = await createProjectRequest({ path: formState.folderPath.trim() });
        onProjectCreated?.(project);
        onClose();
        return;
      }

      const currentAttemptId = createAttemptId();
      activeAttemptRef.current = currentAttemptId;
      setAttemptId(currentAttemptId);
      const project = await cloneWorkspaceWithProgress({
        attemptId: currentAttemptId,
        destinationPath,
        repositoryUrl: formState.repositoryUrl,
        tokenMode: formState.tokenMode,
        selectedGithubToken: formState.selectedGithubToken,
        newGithubToken: formState.newGithubToken,
      }, { onProgress: setCloneProgress });
      onProjectCreated?.(project);
      onClose();
    } catch (caughtError) {
      handleCreationError(caughtError);
    } finally {
      activeAttemptRef.current = null;
      setIsCreating(false);
      setIsCancelling(false);
      setCancellationUnavailable(false);
    }
  }, [destinationPath, formState, handleCreationError, onClose, onProjectCreated, validateConfiguration]);

  const handleCancelClone = useCallback(async () => {
    const currentAttemptId = activeAttemptRef.current;
    if (!currentAttemptId) return;
    setIsCancelling(true);
    try {
      const result = await cancelCloneAttempt(currentAttemptId);
      if (activeAttemptRef.current !== currentAttemptId) return;
      if (result === 'too_late') {
        setCancellationUnavailable(true);
        setCloneProgress((previous) => ({
          phase: previous?.phase || 'finalizing',
          percent: previous?.percent ?? null,
          message: 'Finalization is already in progress. The clone will finish normally.',
        }));
        setIsCancelling(false);
      } else if (result === 'not_found') {
        setCancellationUnavailable(true);
        setCloneProgress((previous) => ({
          phase: previous?.phase || 'finalizing',
          percent: previous?.percent ?? null,
          message: 'Cancellation is no longer available. Waiting for the clone to finish.',
        }));
        setIsCancelling(false);
      }
    } catch {
      if (activeAttemptRef.current !== currentAttemptId) return;
      setCloneProgress((previous) => ({
        phase: previous?.phase || 'preparing',
        percent: previous?.percent ?? null,
        message: 'Cancellation could not be confirmed. The clone is still running.',
      }));
      setIsCancelling(false);
    }
  }, []);

  const handleOpenExistingDestination = useCallback(async () => {
    const existingPath = destinationPath;
    if (!existingPath) {
      showClientError('INVALID_PROJECT_PATH', 'Choose the cloned repository folder.', 'folder');
      return;
    }

    setFormState((previous) => ({
      ...previous,
      mode: 'local',
      folderPath: existingPath,
    }));
    setCredentialRequired(false);
    setStep(3);
    setError(null);
    setFocusField(null);
    setIsCreating(true);
    try {
      const project = await createProjectRequest({ path: existingPath });
      onProjectCreated?.(project);
      onClose();
    } catch (caughtError) {
      handleCreationError(caughtError);
    } finally {
      setIsCreating(false);
    }
  }, [destinationPath, handleCreationError, onClose, onProjectCreated, showClientError]);

  const handleErrorAction = useCallback(() => {
    if (!error) return;
    if (error.action === 'RETRY') {
      void handleCreate();
      return;
    }
    if (error.action === 'INSTALL_GIT') {
      window.open('https://git-scm.com/downloads', '_blank', 'noopener,noreferrer');
      return;
    }
    if (error.action === 'OPEN_EXISTING') {
      void handleOpenExistingDestination();
      return;
    }
    setStep(2);
    setFocusField(error.field);
    if (error.action === 'BROWSE' || error.action === 'CHOOSE_ANOTHER') {
      setBrowseRequestKey((previous) => previous + 1);
    }
  }, [error, handleCreate, handleOpenExistingDestination]);

  const retryLabel = error?.action === 'RETRY'
    ? formState.mode === 'clone' ? 'Retry clone' : 'Retry'
    : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !isCreating && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-h-[90dvh]"
        aria-labelledby="project-creation-title"
      >
        <div className="flex items-center justify-between border-b border-border p-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <DialogTitle id="project-creation-title" className="not-sr-only truncate text-lg font-semibold">
              Create project
            </DialogTitle>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={onClose}
            disabled={isCreating}
            aria-label="Close project creation"
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <WizardProgress step={step} />

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-5">
            {error && (
              <ErrorBanner
                error={error}
                showAction={error.action !== 'RETRY'}
                onAction={handleErrorAction}
              />
            )}
            {step === 1 && (
              <StepModeSelection
                mode={formState.mode}
                onModeChange={(mode) => updateField('mode', mode)}
              />
            )}
            {step === 2 && formState.mode && (
              <StepConfiguration
                mode={formState.mode}
                folderPath={formState.folderPath}
                repositoryUrl={formState.repositoryUrl}
                destinationRoot={formState.destinationRoot}
                credentialRequired={credentialRequired}
                tokenMode={formState.tokenMode}
                selectedGithubToken={formState.selectedGithubToken}
                newGithubToken={formState.newGithubToken}
                availableTokens={availableTokens}
                loadingTokens={loadingTokens}
                tokenLoadError={tokenLoadError}
                isCreating={isCreating}
                focusField={focusField}
                browseRequestKey={browseRequestKey}
                onFolderPathChange={(value) => updateField('folderPath', value)}
                onRepositoryUrlChange={handleRepositoryUrlChange}
                onDestinationRootChange={(value) => updateField('destinationRoot', value)}
                onTokenModeChange={(value: TokenMode) => updateField('tokenMode', value)}
                onSelectedGithubTokenChange={(value) => updateField('selectedGithubToken', value)}
                onNewGithubTokenChange={(value) => updateField('newGithubToken', value)}
              />
            )}
            {step === 3 && formState.mode && (
              <StepReview
                mode={formState.mode}
                folderPath={formState.folderPath}
                repositoryUrl={formState.repositoryUrl}
                destinationPath={destinationPath}
                credentialRequired={credentialRequired}
                tokenMode={formState.tokenMode}
                selectedTokenName={selectedTokenName}
                isCreating={isCreating}
                attemptId={attemptId}
                cloneProgress={cloneProgress}
              />
            )}
          </div>
        </div>

        <WizardFooter
          step={step}
          mode={formState.mode}
          isCreating={isCreating}
          isCancelling={isCancelling}
          cancellationUnavailable={cancellationUnavailable}
          retryLabel={retryLabel}
          onClose={onClose}
          onBack={handleBack}
          onAdvance={handleAdvance}
          onCreate={() => void handleCreate()}
          onCancelClone={() => void handleCancelClone()}
        />
      </DialogContent>
    </Dialog>
  );
}
