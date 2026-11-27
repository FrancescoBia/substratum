import { afterEach, describe, expect, test } from "vitest";
import { playGridExit } from "./grid-exit";

function mountGrid(tiles = 3) {
  const main = document.createElement("main");
  main.style.cssText = "display: block; height: 200px; overflow: auto;";
  const section = document.createElement("section");
  const grid = document.createElement("div");
  grid.className = "grid-entrance";
  for (let i = 0; i < tiles; i++) {
    const tile = document.createElement("div");
    tile.style.height = "100px";
    const img = document.createElement("img");
    img.dataset.lightboxTile = String(i);
    img.style.viewTransitionName = `tile-${i}`;
    tile.append(img);
    grid.append(tile);
  }
  section.append(grid);
  main.append(section);
  document.body.append(main);
  return { main, grid };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  document.body.replaceChildren();
});

describe("playGridExit", () => {
  test("leaves a fading, inert copy once the grid is removed", async () => {
    const { main, grid } = mountGrid();
    playGridExit(grid);
    main.remove();
    await flush();

    const ghost = document.body.querySelector<HTMLElement>("[aria-hidden]");
    expect(ghost).not.toBeNull();
    expect(ghost!.inert).toBe(true);
    expect(ghost!.getAnimations()).toHaveLength(1);
    expect(ghost!.querySelector(".grid-entrance")).toBeNull();
    expect(ghost!.querySelector("[data-lightbox-tile]")).toBeNull();
    expect(ghost!.querySelector("img")!.style.viewTransitionName).toBe("");

    await ghost!.getAnimations()[0].finished;
    await flush();
    expect(ghost!.isConnected).toBe(false);
  });

  test("copies only the tiles on screen when the grid is taller than its view", async () => {
    const { main, grid } = mountGrid(12);
    expect(() => playGridExit(grid)).not.toThrow();
    main.remove();
    await flush();

    const ghost = document.body.querySelector<HTMLElement>("[aria-hidden]");
    const copied = ghost!.children.length;
    expect(copied).toBeGreaterThan(0);
    expect(copied).toBeLessThan(12);
  });

  test("keeps each copied tile where it was on screen after scrolling down", async () => {
    const { main, grid } = mountGrid(12);
    main.scrollTop = 550;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height].map(Math.round);
    };
    const frame = main.getBoundingClientRect();
    const visible = [...grid.children]
      .filter((tile) => {
        const rect = tile.getBoundingClientRect();
        return rect.bottom >= frame.top && rect.top <= frame.bottom;
      })
      .map(box);

    playGridExit(grid);
    main.remove();
    await flush();

    const ghost = document.body.querySelector<HTMLElement>("[aria-hidden]");
    expect([...ghost!.children].map(box)).toEqual(visible);
  });

  test("does nothing when the grid is still there, as in a StrictMode rehearsal", async () => {
    const { grid } = mountGrid();
    playGridExit(grid);
    await flush();
    expect(document.body.querySelector("[aria-hidden]")).toBeNull();
  });
});
