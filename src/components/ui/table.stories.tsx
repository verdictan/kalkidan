import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

const meta = {
  title: 'Layout/Table',
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  { branch: 'main', path: '~/Work/kalkidan', status: 'Clean' },
  { branch: 'feature/onboarding', path: '~/Work/kalkidan-onboarding', status: 'Changed' },
  { branch: 'fix/terminal-resize', path: '~/Work/kalkidan-terminal', status: 'Clean' },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Branch</TableHead>
          <TableHead>Path</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.branch} data-state={index === 1 ? 'selected' : undefined}>
            <TableCell className="font-medium">{row.branch}</TableCell>
            <TableCell className="text-muted-foreground">{row.path}</TableCell>
            <TableCell>
              <Badge size="sm" variant={row.status === 'Clean' ? 'secondary' : 'outline'}>
                {row.status}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Table>
      <TableCaption>Token use in the last 7 days.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead className="text-right">Sessions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Claude Code</TableCell>
          <TableCell className="text-right">18</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Codex</TableCell>
          <TableCell className="text-right">7</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right">25</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};
