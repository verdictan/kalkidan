import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from './button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Button' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="destructive-outline">Delete…</Button>
      <Button variant="link">Link</Button>
      <Button variant="bare">Bare</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Plus />
        New session
      </Button>
      <Button variant="outline" size="sm">
        <Plus />
        Add repository
      </Button>
      <Button variant="destructive">
        <Trash2 />
        Remove
      </Button>
    </div>
  ),
};

export const IconOnly: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Add">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Add">
        <Plus />
      </Button>
      <Button variant="ghost" size="icon-2xs" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Disabled</Button>
      <Button variant="outline" aria-pressed="true">
        Pressed
      </Button>
      <Button variant="outline" aria-invalid="true">
        Invalid
      </Button>
    </div>
  ),
};
