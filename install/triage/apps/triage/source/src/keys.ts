/** True while the person is typing, so single-letter keys stay letters. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable='true']");
}
