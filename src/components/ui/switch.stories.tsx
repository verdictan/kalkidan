import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from './switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  args: { 'aria-label': 'Enable' },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Switch aria-label="Off" />
      <Switch aria-label="On" defaultChecked />
      <Switch aria-label="Disabled" disabled />
      <Switch aria-label="Disabled on" disabled defaultChecked />
    </div>
  ),
};

export const Small: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Switch size="sm" aria-label="Off" />
      <Switch size="sm" aria-label="On" defaultChecked />
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <label className="flex max-w-sm items-center justify-between gap-4 text-sm">
      Open new sessions in a worktree
      <Switch defaultChecked />
    </label>
  ),
};
