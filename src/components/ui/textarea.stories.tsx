import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './textarea';

const meta = {
  title: 'Forms/Textarea',
  component: Textarea,
  args: { placeholder: 'Describe the task', 'aria-label': 'Task description' },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: {
    defaultValue:
      'Add a folder picker to the onboarding flow.\nShow recent folders first and keep the list sorted by name.',
  },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: 'Read only' } };
