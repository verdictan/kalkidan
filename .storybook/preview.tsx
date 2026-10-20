import type { Decorator, Preview } from '@storybook/react-vite';
import { TooltipProvider } from '../src/components/ui/tooltip';
import '../src/styles.css';

// The app uses the light theme unless the root element has the dark class.
const withTheme: Decorator = (Story, context) => {
  document.documentElement.classList.toggle('dark', context.globals.theme === 'dark');
  return (
    <TooltipProvider delayDuration={350}>
      <Story />
    </TooltipProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: { icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: { layout: 'padded' },
};

export default preview;
