import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { FolderOpen } from 'lucide-react';

import { Button, Input } from '../../../shared/view/ui';
import FolderBrowserModal from './FolderBrowserModal';

type WorkspacePathFieldProps = {
  value: string;
  label: string;
  disabled?: boolean;
  allowCreateFolder?: boolean;
  browseRequestKey?: number;
  buttonRef?: RefObject<HTMLButtonElement>;
  onChange: (path: string) => void;
};

export default function WorkspacePathField({
  value,
  label,
  disabled = false,
  allowCreateFolder = false,
  browseRequestKey = 0,
  buttonRef,
  onChange,
}: WorkspacePathFieldProps) {
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  useEffect(() => {
    if (browseRequestKey > 0) setShowFolderBrowser(true);
  }, [browseRequestKey]);

  return (
    <>
      <div className="flex gap-2">
        <Input
          value={value}
          readOnly
          aria-label={`${label} selection`}
          placeholder="No folder selected"
          className="h-11 flex-1 font-mono text-xs"
          disabled={disabled}
        />
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          onClick={() => setShowFolderBrowser(true)}
          className="h-11 min-w-11 px-3"
          aria-label={`Browse for ${label.toLowerCase()}`}
          disabled={disabled}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Browse</span>
        </Button>
      </div>

      <FolderBrowserModal
        isOpen={showFolderBrowser}
        allowCreateFolder={allowCreateFolder}
        onClose={() => setShowFolderBrowser(false)}
        onFolderSelected={(selectedPath) => {
          onChange(selectedPath);
          setShowFolderBrowser(false);
        }}
      />
    </>
  );
}
