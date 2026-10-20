import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { MoreButton } from './more-button';

const meta = {
  title: 'Overlays/DropdownMenu',
  component: DropdownMenu,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-[360px] p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  render: () => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <MoreButton label="Repository actions" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>
          <FolderOpen />
          Open in Finder
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          Copy path
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const Choices: Story = {
  render: () => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <MoreButton label="View options" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="recent">
          <DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Archived sessions</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false}>Hidden files</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
