export function byId<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as unknown as T;
}

/** Only touch the DOM when the text actually changes (render runs every frame). */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Mark the radio button whose data-value matches. */
export function setChecked(group: Element, value: string): void {
  for (const button of group.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
    const checked = button.dataset.value === value;
    button.setAttribute('aria-checked', String(checked));
    button.tabIndex = checked ? 0 : -1;
  }
}

/** Radio-group behavior for a row of buttons: click to pick, arrow keys to move. */
export function onRadio(group: Element, pick: (value: string) => void): void {
  group.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[role="radio"]');
    if (button?.dataset.value) pick(button.dataset.value);
  });
  group.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const current = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(current + step + buttons.length) % buttons.length];
    if (next?.dataset.value) {
      pick(next.dataset.value);
      next.focus();
    }
  });
}
