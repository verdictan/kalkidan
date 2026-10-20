import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronRight } from 'lucide-react';
import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

const meta = {
  title: 'Layout/Collapsible',
  component: Collapsible,
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

const Example = ({ open }: { open: boolean }) => (
  <Collapsible defaultOpen={open} className="max-w-sm">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="group">
        <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
        Advanced settings
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="px-2 pt-2 text-sm text-muted-foreground">
      Set the shell, environment variables and start command for new sessions.
    </CollapsibleContent>
  </Collapsible>
);

export const Open: Story = { render: () => <Example open /> };

export const Closed: Story = { render: () => <Example open={false} /> };
