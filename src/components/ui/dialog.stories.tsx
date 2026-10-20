import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Input } from './input';

const meta = {
  title: 'Overlays/Dialog',
  component: Dialog,
  // A dialog is fixed to the center of the window. The frame keeps it inside the story area.
  decorators: [
    (Story) => (
      <div className="min-h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmation: Story = {
  render: () => (
    <Dialog open>
      <DialogTrigger asChild>
        <Button variant="outline">Remove repository</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Remove repository?</DialogTitle>
          <DialogDescription>
            Kalkidan forgets this repository. The files on disk stay where they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Form: Story = {
  render: () => (
    <Dialog open>
      <DialogTrigger asChild>
        <Button variant="outline">Create project</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>A project groups repositories and sessions.</DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">
          Name
          <Input placeholder="My project" defaultValue="Kalkidan desktop" />
        </label>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const ScrollLayout: Story = {
  render: () => (
    <Dialog open>
      <DialogTrigger asChild>
        <Button variant="outline">Choose folder</Button>
      </DialogTrigger>
      <DialogContent size="lg" layout="scroll" className="h-[480px]">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
          <DialogDescription>Only the list scrolls. The footer stays visible.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="grid gap-1 text-sm">
            {Array.from({ length: 24 }, (_, index) => (
              <li key={index} className="rounded-md px-2 py-1.5 hover:bg-[var(--surface-hover)]">
                ~/Work/repository-{index + 1}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Open</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
