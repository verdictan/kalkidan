import { isMac, shortcutLabel } from '../lib/platform';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

// On Windows and Linux, AltGr sends Ctrl+Alt, so the chat shortcuts use Ctrl+Shift there.
// Keep these keys the same as session-menu.tsx.
const sessionKey = (key: string) => shortcutLabel(isMac ? ['mod', 'alt'] : ['mod', 'shift'], key);

/** The keyboard shortcuts of the app, by area. Each key here has a handler or a menu item. */
export function shortcutGroups(): { title: string; items: [string, string][] }[] {
  return [
    {
      title: 'General',
      items: [
        ['Search or run a command', shortcutLabel(['mod'], 'K')],
        ['Show keyboard shortcuts', shortcutLabel(['mod'], '/')],
        ['Open settings', shortcutLabel(['mod'], ',')],
        ['New chat', shortcutLabel(['mod'], 'N')],
        ['New project', shortcutLabel(['mod', 'shift'], 'N')],
        ['New task', shortcutLabel(['mod', 'shift'], 'K')],
        ['Add a code folder', shortcutLabel(['mod', 'shift'], 'O')],
        ['Show or hide the sidebar', shortcutLabel(['mod'], 'B')],
        ['Close the tool tab or the chat', shortcutLabel(['mod'], 'W')],
      ],
    },
    {
      title: 'Navigation',
      items: [
        ['Go back', isMac ? shortcutLabel(['mod'], '[') : shortcutLabel(['alt'], '←')],
        ['Go forward', isMac ? shortcutLabel(['mod'], ']') : shortcutLabel(['alt'], '→')],
        ['Go to the project overview', shortcutLabel(['mod'], '1')],
        ['Go to Tasks', shortcutLabel(['mod'], '2')],
        ['Go to Chats', shortcutLabel(['mod'], '3')],
        ['Go to Docs', shortcutLabel(['mod'], '4')],
        ['Go to Memory', shortcutLabel(['mod'], '5')],
        ['Go to Insights', shortcutLabel(['mod'], '6')],
        ['Show all chats', shortcutLabel(['mod', 'shift'], 'L')],
        ['Move between sidebar rows', '↑ ↓'],
        ['Expand or collapse a project', '→ ←'],
        ['Show the actions of a sidebar row', shortcutLabel(['shift'], 'F10')],
        ['Move between search results', '↑ ↓'],
        ['Open the search result', 'Enter'],
        ['Close the search', 'Esc'],
      ],
    },
    {
      title: 'Chat',
      items: [
        ['Send the message', 'Enter'],
        ['Add a new line', shortcutLabel(['shift'], 'Enter')],
        ['Rename the chat', sessionKey(isMac ? 'R' : 'E')],
        ['Pin or unpin the chat', sessionKey('P')],
        ['Open a second chat beside this one', sessionKey('S')],
        ['Archive the chat', shortcutLabel(['mod', 'shift'], 'A')],
      ],
    },
    {
      title: 'Tools',
      items: [
        ['Show or hide the terminal', shortcutLabel([isMac ? 'ctrl' : 'mod'], '`')],
        ['New tool tab', shortcutLabel(['mod'], 'T')],
        ['Show the changes', shortcutLabel(['mod', 'shift'], 'G')],
        ['Find in the browser page', shortcutLabel(['mod'], 'F')],
      ],
    },
    {
      title: 'Docs',
      items: [
        ['Save the page', shortcutLabel(['mod'], 'S')],
        ['Add a link to the selected text', shortcutLabel(['mod'], 'K')],
        ['Insert a block', '/'],
      ],
    },
  ];
}

/** Help › Keyboard shortcuts: one sheet with every shortcut, grouped by area. */
export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" layout="scroll">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Text fields and the terminal keep their own keys. In a doc,{' '}
            {shortcutLabel(['mod'], 'K')} adds a link when text is selected. Else it opens search.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="shortcuts-sheet">
            {shortcutGroups().map((group) => (
              <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
                <h3 id={`shortcuts-${group.title}`} className="shortcuts-title">
                  {group.title}
                </h3>
                <dl className="shortcuts-list">
                  {group.items.map(([label, keys]) => (
                    <div key={label} className="shortcuts-row">
                      <dt>{label}</dt>
                      <dd>
                        <kbd className="kbd">{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
