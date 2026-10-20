import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  args: { placeholder: 'Repository name', 'aria-label': 'Repository name' },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filled: Story = { args: { variant: 'filled', placeholder: 'Filter sessions' } };

export const WithValue: Story = { args: { defaultValue: 'kalkidan' } };

export const States: Story = {
  render: () => (
    <div className="grid gap-2">
      <Input aria-label="Disabled" disabled defaultValue="Disabled" />
      <Input aria-label="Invalid" aria-invalid="true" defaultValue="not a valid path" />
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <label className="grid gap-1.5 text-sm font-medium">
      Host
      <Input placeholder="devbox.internal" />
      <span className="text-xs font-normal text-muted-foreground">
        A host name from your SSH config.
      </span>
    </label>
  ),
};
