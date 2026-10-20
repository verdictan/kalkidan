import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Columns3, List } from 'lucide-react';
import { SegmentedControl } from './segmented-control';

const meta = {
  title: 'Forms/SegmentedControl',
  component: SegmentedControl,
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ size }: { size?: 'sm' | 'md' }) {
  const [value, setValue] = useState('none');
  return (
    <SegmentedControl
      size={size}
      label="Tracker connection"
      value={value}
      onChange={setValue}
      options={[
        { value: 'none', label: 'None' },
        { value: 'github', label: 'GitHub' },
        { value: 'linear', label: 'Linear' },
        { value: 'jira', label: 'Jira', disabled: true },
      ]}
    />
  );
}

export const Default: Story = {
  args: { label: '', value: '', onChange: () => {}, options: [] },
  render: () => <Example />,
};

export const Small: Story = {
  args: { label: '', value: '', onChange: () => {}, options: [] },
  render: () => <Example size="sm" />,
};

export const WithIcons: Story = {
  args: { label: '', value: '', onChange: () => {}, options: [] },
  render: function Render() {
    const [view, setView] = useState('board');
    return (
      <SegmentedControl
        size="sm"
        label="Task view"
        value={view}
        onChange={setView}
        options={[
          { value: 'board', label: 'Board', icon: <Columns3 /> },
          { value: 'list', label: 'List', icon: <List /> },
        ]}
      />
    );
  },
};
