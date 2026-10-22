import { isMac, shortcutLabel } from '../lib/platform';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

/**
 * The keyboard shortcuts of the app that are not obvious, by area: about 15. Menus and ⌘K show
 * the key of each other action on its row. Each key here has a handler or a menu item.
 */
export function shortcutGroups(): { title: string; items: [string, string][] }[] {
  return [
    {
      title: 'General',
      items: [
        ['Search or run a command', shortcutLabel(['mod'], 'K')],
        ['New chat', shortcutLabel(['mod'], 'N')],
        ['New project', shortcutLabel(['mod', 'shift'], 'N')],
        ['Settings', shortcutLabel(['mod'], ',')],
        ['Show or hide the sidebar', shortcutLabel(['mod'], 'B')],
        ['Close the chat', shortcutLabel(['mod'], 'W')],
      ],
    },
    {
      title: 'Navigation',
      items: [
        ['Go back', isMac ? shortcutLabel(['mod'], '[') : shortcutLabel(['alt'], '←')],
        ['Go forward', isMac ? shortcutLabel(['mod'], ']') : shortcutLabel(['alt'], '→')],
        [
          'Go to Overview, Tasks, Chats or Knowledge',
          `${shortcutLabel(['mod'], '1')}–${shortcutLabel(['mod'], '4')}`,
        ],
        ['Show all chats', shortcutLabel(['mod', 'shift'], 'L')],
      ],
    },
    {
      title: 'Chat',
      items: [
        ['Show the changes', shortcutLabel(['mod', 'shift'], 'G')],
        ['Show or hide the terminal', shortcutLabel([isMac ? 'ctrl' : 'mod'], '`')],
        ['Archive the chat', shortcutLabel(['mod', 'shift'], 'A')],
      ],
    },
    {
      title: 'Tasks',
      items: [
        ['New task', 'N'],
        ['Start the task', 'S'],
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
