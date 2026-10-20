import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
  title: 'Overlays/Tooltip',
  component: Tooltip,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex h-[160px] items-center justify-center">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="New session">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New session</TooltipContent>
      </Tooltip>
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <div className="grid h-[320px] grid-cols-2 place-items-center gap-x-48 gap-y-12 px-24 py-16">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} open>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm">
              {side}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>Shown on the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
};
