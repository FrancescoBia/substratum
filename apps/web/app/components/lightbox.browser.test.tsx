import "~/app.css";
import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Lightbox, type LightboxImage } from "./lightbox";

const image = (id: string, width = 1200, height = 800): LightboxImage => ({
  id,
  kind: "image",
  width,
  height,
  durationMs: null,
  format: "png",
  byteSize: 1000,
  title: id,
  sourcePageUrl: null,
});

const IMAGES = ["a", "b", "c", "d"].map((id) => image(id));

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const settle = () => Promise.all(document.getAnimations().map((a) => a.finished));

type Sample = { time: number; slot: number; target: number; painted: number };

/**
 * Every frame of a step, for every slot: the opacity the spring asked for (its
 * `--dim`) against the opacity actually painted. The two should move together;
 * anything between them is a CSS transition lagging the spring.
 */
async function sampleStep(trigger: () => unknown) {
  const slots = () => [...document.querySelectorAll<HTMLElement>("[role=dialog] img")];
  const samples: Sample[] = [];
  const start = await nextFrame();

  await trigger();

  let still = 0;
  let last = "";
  while (still < 10) {
    const now = await nextFrame();
    const frame = slots().map((el) => ({
      time: now - start,
      slot: Number(el.getAttribute("src")!.split("/")[2].charCodeAt(0) - 97),
      target: parseFloat(getComputedStyle(el).getPropertyValue("--dim")),
      painted: parseFloat(getComputedStyle(el).opacity),
    }));
    samples.push(...frame);
    const signature = JSON.stringify(frame.map((s) => [s.target, s.painted]));
    still = signature === last ? still + 1 : 0;
    last = signature;
  }
  return samples;
}

function Harness() {
  return <Lightbox images={IMAGES} context="Test" />;
}

async function open() {
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  await render(<Stub initialEntries={["/?view=a"]} />);
  await expect.poll(() => document.querySelector("[role=dialog] img[data-current]")).toBeTruthy();
  await settle();
}

function expectInStep(samples: Sample[]) {
  for (const slot of [0, 1, 2]) {
    const series = samples.filter((s) => s.slot === slot);
    const trace = series
      .map((s) => `${Math.round(s.time)}ms ${s.target.toFixed(3)} → ${s.painted.toFixed(3)}`)
      .join("\n");
    const worst = Math.max(...series.map((s) => Math.abs(s.painted - s.target)));
    expect(
      worst,
      `slot ${slot} lags the spring by up to ${worst.toFixed(3)}\n${trace}`,
    ).toBeLessThan(0.02);
  }
}

describe("Lightbox strip", () => {
  test("stepping with the keyboard: painted opacity follows the spring", async () => {
    await open();
    expectInStep(
      await sampleStep(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })),
      ),
    );
  });

  test("a cursor resting on the open image doesn't hold it bright as it moves aside", async () => {
    await open();
    await userEvent.hover(document.querySelector<HTMLElement>("[role=dialog] img[data-current]")!);
    expectInStep(
      await sampleStep(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })),
      ),
    );
  });

  test("moving the pointer onto a neighbour brings it to full strength", async () => {
    await open();
    const neighbour = document.querySelector<HTMLElement>(
      '[role=dialog] img[src="/img/b/medium"]',
    )!;
    await userEvent.hover(neighbour);
    await expect.poll(() => getComputedStyle(neighbour).opacity).toBe("1");
  });

  test("stepping by clicking a neighbour: painted opacity follows the spring", async () => {
    await open();
    const neighbour = document.querySelector<HTMLElement>(
      '[role=dialog] img[src="/img/b/medium"]',
    )!;
    expectInStep(await sampleStep(() => userEvent.click(neighbour)));
  });
});
