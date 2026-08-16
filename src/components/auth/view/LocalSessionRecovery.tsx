import AuthScreenLayout from './AuthScreenLayout';

type LocalSessionRecoveryProps = {
  message: string;
  onRetry: () => Promise<void>;
};

export default function LocalSessionRecovery({ message, onRetry }: LocalSessionRecoveryProps) {
  const canRenewFromDesktop = Boolean(window.cloudcliDesktopLocalSession);
  return (
    <AuthScreenLayout
      title={canRenewFromDesktop ? 'Reconnect local workspace' : 'Reopen from Desktop'}
      description={canRenewFromDesktop
        ? message
        : 'In CloudCLI Desktop, choose Open in browser again to create a new one-time session.'}
      footerText={canRenewFromDesktop
        ? 'Keep the Desktop app open while reconnecting.'
        : 'After reopening from Desktop, you can check this page again.'}
    >
      <div>
        <button
          type="button"
          className="min-h-11 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => void onRetry()}
        >
          {canRenewFromDesktop ? 'Retry' : 'Check again'}
        </button>
      </div>
    </AuthScreenLayout>
  );
}
