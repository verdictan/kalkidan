import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

const meta = {
  title: 'Forms/Select',
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = (
  <>
    <SelectItem value="claude">Claude Code</SelectItem>
    <SelectItem value="codex">Codex</SelectItem>
  </>
);

export const Default: Story = {
  render: () => (
    <Select defaultValue="claude">
      <SelectTrigger className="w-48" aria-label="Agent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{items}</SelectContent>
    </Select>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {(['outline', 'filled', 'ghost'] as const).map((variant) => (
        <Select key={variant} defaultValue="claude">
          <SelectTrigger variant={variant} aria-label={`Agent ${variant}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>{items}</SelectContent>
        </Select>
      ))}
      <Select defaultValue="claude">
        <SelectTrigger size="sm" aria-label="Agent small">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{items}</SelectContent>
      </Select>
    </div>
  ),
};

export const Placeholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-48" aria-label="Branch">
        <SelectValue placeholder="Choose a branch" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="main">main</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Open: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="h-[280px] p-6">
      <Select defaultValue="main" open>
        <SelectTrigger className="w-56" aria-label="Branch">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectLabel>Local</SelectLabel>
            <SelectItem value="main">main</SelectItem>
            <SelectItem value="feature">feature/onboarding</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Remote</SelectLabel>
            <SelectItem value="origin">origin/main</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};
