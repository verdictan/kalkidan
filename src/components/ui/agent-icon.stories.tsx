import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentIcon } from './agent-icon';

const meta = {
  title: 'Icons/AgentIcon',
  component: AgentIcon,
  args: { agent: 'claude' },
} satisfies Meta<typeof AgentIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Agents: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-sm">
      <span className="flex items-center gap-1.5">
        <AgentIcon agent="claude" />
        Claude Code
      </span>
      <span className="flex items-center gap-1.5">
        <AgentIcon agent="codex" />
        Codex
      </span>
    </div>
  ),
};
