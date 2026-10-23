import type { Meta, StoryObj } from '@storybook/react-vite';
import { identityColorLabels, identityColorNames } from '../../domain/identity';
import { IdentityMark, IdentityToken } from './identity-mark';
import { Row } from './row';
import { StatusGlyph } from './status-glyph';

const meta = {
  title: 'Identity/IdentityMark',
  component: IdentityMark,
  args: { kind: 'project', color: 'indigo' },
} satisfies Meta<typeof IdentityMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** One shape per level, at both sizes. */
export const Levels: Story = {
  render: () => (
    <div className="grid gap-2">
      {(['project', 'repo', 'session', 'subagent'] as const).map((kind) => (
        <div key={kind} className="flex items-center gap-2">
          <IdentityMark kind={kind} color="indigo" />
          <IdentityMark kind={kind} color="indigo" size="lg" />
          {kind}
        </div>
      ))}
    </div>
  ),
};

export const Palette: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-2">
      {identityColorNames.map((color) => (
        <IdentityToken key={color} kind="project" color={color} name={identityColorLabels[color]} />
      ))}
    </div>
  ),
};

/** Status is a trailing glyph, never the mark. */
export const WithStatus: Story = {
  render: () => (
    <div className="grid w-64 gap-1">
      <Row leading={<IdentityMark kind="session" color="pink" />} title="Idle" meta="2m" />
      <Row
        leading={<IdentityMark kind="session" color="pink" />}
        title="Working"
        status="working"
      />
      <Row
        leading={<IdentityMark kind="session" color="pink" />}
        title="Needs you"
        status="needs-you"
        selected
        tint="pink"
      />
      <Row leading={<IdentityMark kind="session" color="pink" />} title="Failed" status="failed" />
      <div className="flex gap-2">
        <StatusGlyph status="working" />
        <StatusGlyph status="needs-you" />
        <StatusGlyph status="failed" />
      </div>
    </div>
  ),
};
