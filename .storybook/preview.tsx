import type { Decorator, Preview } from '@storybook/react-vite';
import { TooltipProvider } from '../src/components/ui/tooltip';
import '../src/styles.css';

// Kalkidan has only a light theme.
const withProviders: Decorator = (Story) => {
  return (
    <TooltipProvider delayDuration={350}>
      <Story />
    </TooltipProvider>
  );
};

const preview: Preview = {
  decorators: [withProviders],
  parameters: { layout: 'padded' },
};

export default preview;
