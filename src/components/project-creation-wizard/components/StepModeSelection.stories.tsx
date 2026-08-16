import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ProjectCreationMode } from '../types';

import StepModeSelection from './StepModeSelection';

function ModeSelectionFixture() {
  const [mode, setMode] = useState<ProjectCreationMode | null>('local');
  return (
    <div className="w-[min(560px,calc(100vw-32px))] rounded-xl border border-border bg-card p-5">
      <StepModeSelection mode={mode} onModeChange={setMode} />
    </div>
  );
}

const meta = {
  title: 'Desktop UX/Projects/Create mode',
  component: StepModeSelection,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof StepModeSelection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KeyboardSelectable: Story = {
  args: { mode: 'local', onModeChange: () => undefined },
  render: () => <ModeSelectionFixture />,
};
