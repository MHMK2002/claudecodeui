import type { Meta, StoryObj } from '@storybook/react-vite';

import { Alert, AlertDescription, AlertTitle } from './Alert';
import { Button } from './Button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './Dialog';
import { Input } from './Input';

function SharedPrimitives() {
  return (
    <div className="w-[min(560px,calc(100vw-32px))] space-y-6 rounded-xl border border-border bg-background p-6 text-foreground">
      <div className="flex flex-wrap gap-3">
        <Button>Primary action</Button>
        <Button variant="outline">Secondary action</Button>
        <Button variant="destructive">Delete</Button>
      </div>

      <label className="block space-y-1 text-sm font-medium">
        Accessible input
        <Input placeholder="Type a value" />
      </label>

      <Alert>
        <AlertTitle>Saved locally</AlertTitle>
        <AlertDescription>Your workspace data remains on this device.</AlertDescription>
      </Alert>

      <Collapsible>
        <CollapsibleTrigger className="min-h-11 rounded-md border border-border px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Advanced options
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="pt-3 text-sm text-muted-foreground">Progressively disclosed content.</p>
        </CollapsibleContent>
      </Collapsible>

      <Dialog>
        <DialogTrigger className="min-h-11 rounded-md border border-border px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Open dialog
        </DialogTrigger>
        <DialogContent className="p-6" aria-labelledby="storybook-dialog-title">
          <DialogTitle id="storybook-dialog-title" className="not-sr-only text-lg font-semibold">
            Shared dialog
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">Escape closes and returns focus to the trigger.</p>
          <Button className="mt-4">Continue</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const meta = {
  title: 'Shared/Primitives',
  component: SharedPrimitives,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SharedPrimitives>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContractStates: Story = {};
