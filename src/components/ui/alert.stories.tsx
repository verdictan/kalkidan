import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleAlert, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';

const meta = {
  title: 'Feedback/Alert',
  component: Alert,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert className="max-w-md">
      <Info />
      <AlertTitle>GitHub CLI is not signed in</AlertTitle>
      <AlertDescription>Sign in with gh auth login to see pull requests.</AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="max-w-md">
      <CircleAlert />
      <AlertTitle>The repository could not be opened</AlertTitle>
      <AlertDescription>The folder was moved or deleted. Choose a new location.</AlertDescription>
    </Alert>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <Alert className="max-w-md">
      <Info />
      <AlertTitle>Changes are saved automatically.</AlertTitle>
    </Alert>
  ),
};
