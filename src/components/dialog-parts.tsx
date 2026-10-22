/** The Radix open handler that keeps the focus on the dialog until a form has loaded. */
export function holdDialogFocus(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}
