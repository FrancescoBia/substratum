import { afterEach, describe, expect, test } from "vitest";
import { moveFocus } from "./move-focus";

const button = (label: string) => {
  const element = document.createElement("button");
  element.textContent = label;
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("moveFocus", () => {
  test("focuses the element", () => {
    const target = button("Target");
    moveFocus(target, { quiet: false });
    expect(document.activeElement).toBe(target);
    expect(target.hasAttribute("data-quiet-focus")).toBe(false);
  });

  test("quietly hides the ring until the next key press", () => {
    const target = button("Target");
    moveFocus(target, { quiet: true });
    expect(document.activeElement).toBe(target);
    expect(target.hasAttribute("data-quiet-focus")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(target.hasAttribute("data-quiet-focus")).toBe(false);
  });

  test("quietly hides the ring until focus leaves", () => {
    const target = button("Target");
    const other = button("Other");
    moveFocus(target, { quiet: true });

    other.focus();
    expect(target.hasAttribute("data-quiet-focus")).toBe(false);
  });
});
