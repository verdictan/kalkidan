import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ellipsis, Globe, SquareTerminal } from 'lucide-react';
import { Button } from './button';
import { IdentityToken } from './identity-mark';
import { PageHeader } from './page-header';

const meta = {
  title: 'Layout/PageHeader',
  component: PageHeader,
  args: { title: 'Atlas' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

const more = (
  <Button size="icon-sm" variant="ghost" aria-label="More">
    <Ellipsis />
  </Button>
);

/** A project: the mark, the name and the views. The current view takes the project's tint. */
export const Project: Story = {
  args: {
    mark: { kind: 'project', color: 'indigo' },
    title: 'Atlas',
    viewsLabel: 'Project page',
    views: [
      { value: 'overview', label: 'Overview' },
      { value: 'tasks', label: 'Tasks' },
      { value: 'knowledge', label: 'Knowledge' },
    ],
    view: 'overview',
    actions: more,
  },
};

/** A chat: the crumbs replace the title, and the header takes a 5% tint of the session color. */
export const Chat: Story = {
  args: {
    tint: 'pink',
    crumbs: (
      <>
        <IdentityToken kind="project" color="indigo" name="Atlas" />
        <IdentityToken kind="repo" color="blue" name="atlas-web" />
        <IdentityToken kind="session" color="pink" name="Add sign-in integration tests" strong />
      </>
    ),
    actions: (
      <>
        <Button size="icon-sm" variant="ghost" aria-label="Terminal">
          <SquareTerminal />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Browser">
          <Globe />
        </Button>
        {more}
      </>
    ),
  },
};

/** Settings: neutral views; project views carry their marks. */
export const Settings: Story = {
  args: {
    title: 'Settings',
    views: [
      { value: 'general', label: 'General' },
      { value: 'tools', label: 'Tools' },
      { value: 'account', label: 'Account' },
      { value: 'atlas', label: 'Atlas', mark: { kind: 'project', color: 'indigo' } },
    ],
    view: 'tools',
    actions: <Button variant="secondary">Check again</Button>,
  },
};
