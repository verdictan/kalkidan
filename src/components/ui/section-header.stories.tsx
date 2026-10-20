import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { Button } from './button';
import { SectionHeader } from './page-header';

const meta = {
  title: 'Layout/SectionHeader',
  component: SectionHeader,
  args: { title: 'Sessions' },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { count: 3 } };

export const WithActions: Story = {
  args: {
    title: 'Worktrees',
    count: 2,
    actions: (
      <Button variant="ghost" size="sm">
        <Plus />
        New worktree
      </Button>
    ),
  },
};

export const Subsection: Story = { args: { title: 'Tracker (optional)', as: 'h4' } };
