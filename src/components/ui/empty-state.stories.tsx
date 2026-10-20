import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitBranch, GitFork, Layers2, Plus } from 'lucide-react';
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
    icon: <Layers2 />,
    title: 'Organize your repositories',
    children: 'Create a project to group repositories, sessions and tasks.',
    action: (
      <Button size="lg">
        <Plus />
        Create project
      </Button>
    ),
  },
};

export const Compact: Story = {
  args: {
    compact: true,
    icon: <GitBranch />,
    title: 'No Git worktrees available',
    children: 'Create a worktree to work on a branch in its own folder.',
  },
};

export const WithSecondaryAction: Story = {
  args: {
    icon: <GitFork />,
    title: 'Connect your project tracker',
    children: 'See GitHub, Linear or Jira tasks next to your sessions.',
    action: (
      <div className="flex flex-wrap justify-center gap-2">
        <Button>Connect tracker</Button>
        <Button variant="outline">Learn more</Button>
      </div>
    ),
  },
};

export const TextOnly: Story = {
  args: { compact: true, children: 'No changes in this scope' },
};
