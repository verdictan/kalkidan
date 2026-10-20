import type { Meta, StoryObj } from '@storybook/react-vite';
import { Folder, GitBranch, Server } from 'lucide-react';
import { EntityIcon } from './entity-icon';

const meta = {
  title: 'Icons/EntityIcon',
  component: EntityIcon,
  args: { children: <GitBranch /> },
} satisfies Meta<typeof EntityIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <EntityIcon>
        <GitBranch />
      </EntityIcon>
      <EntityIcon size="lg">
        <GitBranch />
      </EntityIcon>
    </div>
  ),
};

export const Colors: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <EntityIcon size="lg" color="#3b82f6">
        <Folder />
      </EntityIcon>
      <EntityIcon size="lg" color="#22c55e">
        <Folder />
      </EntityIcon>
      <EntityIcon size="lg" color="#f97316">
        <Server />
      </EntityIcon>
      <EntityIcon size="lg" color="#a855f7">
        <Folder />
      </EntityIcon>
    </div>
  ),
};
