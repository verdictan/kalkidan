import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleCheck } from 'lucide-react';
import { Badge } from './badge';

const meta = {
  title: 'Feedback/Badge',
  component: Badge,
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="destructive">Failed</Badge>
      <Badge variant="link">Link</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="sm" variant="secondary">
        main
      </Badge>
      <Badge size="md" variant="secondary">
        Running
      </Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Badge variant="outline">
      <CircleCheck />
      Merged
    </Badge>
  ),
};
