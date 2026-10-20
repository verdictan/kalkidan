import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';

const meta = {
  title: 'Layout/Card',
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="max-w-sm">
      <strong className="text-sm">kalkidan</strong>
      <span className="text-sm text-muted-foreground">3 sessions · 2 worktrees</span>
    </Card>
  ),
};

export const WithSections: Story = {
  render: () => (
    <Card className="max-w-md gap-4 px-0 py-6">
      <CardHeader>
        <CardTitle>Remote host</CardTitle>
        <CardDescription>Run agents on a machine you reach over SSH.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">devbox.internal · port 22</CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button>Connect</Button>
      </CardFooter>
    </Card>
  ),
};
