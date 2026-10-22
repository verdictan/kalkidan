import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitBranch, Plus } from 'lucide-react';
import { Button } from './button';
import { EntityIcon } from './entity-icon';
import { MoreButton } from './more-button';
import { PageHeader } from './page-header';

const meta = {
  title: 'Layout/PageHeader',
  component: PageHeader,
  args: { title: 'kalkidan' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: (
      <EntityIcon>
        <GitBranch />
      </EntityIcon>
    ),
    title: 'kalkidan',
    subtitle: '~/Work/verdictan/kalkidan',
    actions: (
      <>
        <Button>
          <Plus />
          New session
        </Button>
        <MoreButton size="md" label="Repository actions" />
      </>
    ),
  },
};

export const TitleOnly: Story = { args: { title: 'Settings' } };

export const WithSubtitle: Story = {
  args: { title: 'Projects', subtitle: 'Group repositories, sessions and tasks.' },
};

export const ReservedSubtitle: Story = { args: { title: 'Tasks', reserveSubtitle: true } };
