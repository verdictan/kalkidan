import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreButton } from './more-button';

const meta = {
  title: 'Actions/MoreButton',
  component: MoreButton,
  args: { label: 'More actions' },
} satisfies Meta<typeof MoreButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InRow: Story = {
  render: (args) => (
    <div className="flex max-w-sm items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-hover)]">
      feature/onboarding
      <MoreButton {...args} size="xs" label="Worktree actions" />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <MoreButton {...args} size="md" />
      <MoreButton {...args} size="sm" />
      <MoreButton {...args} size="xs" />
    </div>
  ),
};
