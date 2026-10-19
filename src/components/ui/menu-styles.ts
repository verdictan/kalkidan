// One look for every menu: dropdown, context and editor menus share these classes.
export const menuContentClass =
  'z-50 min-w-[12rem] overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md';
export const menuItemClass =
  "relative flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-hidden select-none focus:bg-[var(--surface-selected)] focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=open]:bg-[var(--surface-selected)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground";
export const menuLabelClass = 'px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground';
export const menuSeparatorClass = '-mx-1 my-1 h-px bg-border';
export const menuShortcutClass = 'ml-auto pl-4 text-xs text-muted-foreground';
