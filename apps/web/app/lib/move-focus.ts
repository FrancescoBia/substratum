/**
 * Moves focus to `element` from code. Browsers show the focus ring on an
 * element focused this way if the one before it showed it, and a text field
 * always does, so pressing Enter in a field would ring whatever comes next even
 * when the person got there with the mouse. With `quiet`, the ring stays hidden
 * (anything styled with `:not([data-quiet-focus])`) until the next key press,
 * or until focus leaves.
 */
export const moveFocus = (element: HTMLElement, { quiet }: { quiet: boolean }) => {
  if (quiet) {
    element.setAttribute("data-quiet-focus", "");
    const clear = () => {
      element.removeAttribute("data-quiet-focus");
      document.removeEventListener("keydown", clear, true);
      element.removeEventListener("blur", clear);
    };
    document.addEventListener("keydown", clear, true);
    element.addEventListener("blur", clear);
  }
  element.focus({ preventScroll: true });
};
