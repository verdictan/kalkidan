import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { EmptyState } from './empty-state';

const meta = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'No pages yet.',
    action: (
      <Button size="sm" variant="outline">
        New page
      </Button>
    ),
  },
};

export const WithText: Story = {
  args: {
    title: 'No board',
    children: 'Connect a GitHub Projects board to plan tasks.',
    action: (
      <Button size="sm" variant="outline">
        Connect board
      </Button>
    ),
  },
};

export const Compact: Story = {
  args: { compact: true, children: 'No changes in this folder.' },
};
