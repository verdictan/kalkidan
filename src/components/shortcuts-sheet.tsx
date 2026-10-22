import { isMac, shortcutLabel } from '../lib/platform';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

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
        ['Open preferences', shortcutLabel(['mod'], ',')],
        ['New chat', shortcutLabel(['mod'], 'N')],
        ['New project', shortcutLabel(['mod', 'shift'], 'N')],
        ['New task', shortcutLabel(['mod', 'shift'], 'K')],
        ['Add code folder', shortcutLabel(['mod', 'shift'], 'O')],
        ['Show or hide the sidebar', shortcutLabel(['mod'], 'B')],
        ['Close the tool tab or the chat', shortcutLabel(['mod'], 'W')],
      ],
    },
    {
      title: 'Navigation',
      items: [
        ['Go back', isMac ? shortcutLabel(['mod'], '[') : shortcutLabel(['alt'], '←')],
        ['Go forward', isMac ? shortcutLabel(['mod'], ']') : shortcutLabel(['alt'], '→')],
        ['Go to Overview', shortcutLabel(['mod'], '1')],
        ['Go to Tasks', shortcutLabel(['mod'], '2')],
        ['Go to Chats', shortcutLabel(['mod'], '3')],
        ['Go to Knowledge', shortcutLabel(['mod'], '4')],
        ['Show all chats', shortcutLabel(['mod', 'shift'], 'L')],
        ['Move between sidebar rows', '↑ ↓'],
        ['Collapse or expand a project', '← →'],
        ['Show the actions of a sidebar row', shortcutLabel(['shift'], 'F10')],
        // The search shows its other keys (↑ ↓, ↵, Esc) at its bottom edge.
        ['Ask an agent about the search text', shortcutLabel(['mod'], '↵')],
      ],
    },
    {
      title: 'Tasks',
      items: [
        ['Move between tasks', '↑ ↓ ← →'],
        ['Select the task', 'Space'],
        ['Start the task', 'S'],
        ['Open the task', '↵'],
        ['Select all tasks', shortcutLabel(['mod'], 'A')],
      ],
    },
    {
      title: 'Chat',
      items: [
        ['Send the message', '↵'],
        ['Add a new line', shortcutLabel(['shift'], '↵')],
        ['Rename the chat', sessionKey(isMac ? 'R' : 'E')],
        ['Pin or unpin the chat', sessionKey('P')],
        ['Open side chat', sessionKey('S')],
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
        ['Add a link to the selected text', shortcutLabel(['mod'], 'L')],
        ['Link to a page', '[[ or @'],
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
      <DialogContent
        size="lg"
        layout="scroll"
        aria-describedby={undefined}
        className="max-h-[80vh]"
        // The sheet only shows information. The focus goes to the sheet, not to the close
        // button, so no focus ring shows when it opens.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
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
