import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchInput } from './search-input';

const meta = {
  title: 'Forms/SearchInput',
  component: SearchInput,
  args: { placeholder: 'Search repositories', 'aria-label': 'Search repositories' },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SmallFilled: Story = {
  args: { size: 'sm', variant: 'filled', placeholder: 'Filter' },
};

export const WithValue: Story = { args: { defaultValue: 'onboarding' } };
