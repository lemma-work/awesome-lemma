/** True while the person is typing, so single-letter keys stay letters. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable='true']");
}

/** True when a key should be left alone: typing, a modifier, or a sheet or menu open. */
export function busyKey(e: KeyboardEvent): boolean {
  return typing(e) || e.metaKey || e.ctrlKey || e.altKey || !!document.querySelector(".c-sheet, .c-menu");
}

export function useWideQuery(): string {
  return "(min-width: 900px)";
}
