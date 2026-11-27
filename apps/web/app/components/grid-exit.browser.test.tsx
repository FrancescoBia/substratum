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
    const copied = ghost!.querySelector("section > div")!.children.length;
    expect(copied).toBeGreaterThan(0);
    expect(copied).toBeLessThan(12);
  });

  test("does nothing when the grid is still there, as in a StrictMode rehearsal", async () => {
    const { grid } = mountGrid();
    playGridExit(grid);
    await flush();
    expect(document.body.querySelector("[aria-hidden]")).toBeNull();
  });
});
