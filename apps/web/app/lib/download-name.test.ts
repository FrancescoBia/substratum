import { describe, expect, test } from "vitest";
import { contentDisposition, downloadFilename, type NamedImage } from "./download-name";

/**
 * What a served file is called when it is saved or dragged out of the browser.
 */

const ID = "8f14e45f-ceea-467a-9575-1f6a1c0e1d2b";

function image(fields: Partial<NamedImage>): NamedImage {
  return {
    id: ID,
    filename: null,
    sourceImageUrl: null,
    title: null,
    sourcePageTitle: null,
    ...fields,
  };
}

describe("downloadFilename", () => {
  test("an upload keeps the name it had on disk, extension as written", () => {
    expect(downloadFilename(image({ filename: "IMG_0042.JPG" }), "jpeg")).toBe("IMG_0042.JPG");
    expect(downloadFilename(image({ filename: "stairwell.jpeg" }), "jpeg")).toBe("stairwell.jpeg");
  });

  test("a capture is named for the last segment of the URL it came from", () => {
    const captured = image({
      sourceImageUrl: "https://cdn.example.com/photos/brutalist%20stairwell.png?w=1200",
      title: "Renamed by the Owner",
      sourcePageTitle: "Some page",
    });
    expect(downloadFilename(captured, "png")).toBe("brutalist stairwell.png");
  });

  test("an extension for another format is replaced, not doubled", () => {
    const captured = image({ sourceImageUrl: "https://example.com/hero.jpg" });
    expect(downloadFilename(captured, "webp")).toBe("hero.webp");
    expect(downloadFilename(image({ filename: "clip.MOV" }), "mp4")).toBe("clip.mp4");
  });

  test("a name with no extension, or a non-media one, gets the right one appended", () => {
    const captured = image({ sourceImageUrl: "https://images.example.com/abc123" });
    expect(downloadFilename(captured, "avif")).toBe("abc123.avif");
    expect(downloadFilename(image({ filename: "v1.2 final" }), "png")).toBe("v1.2 final.png");
  });

  test("with no filename or URL name, the title stands in, then the id", () => {
    expect(
      downloadFilename(image({ sourceImageUrl: "https://example.com/", title: "Wave" }), "gif"),
    ).toBe("Wave.gif");
    expect(downloadFilename(image({ sourcePageTitle: "A page" }), "jpeg")).toBe("A page.jpg");
    expect(downloadFilename(image({}), "jpeg")).toBe(`${ID}.jpg`);
  });

  test("characters no file system takes are dropped", () => {
    expect(downloadFilename(image({ title: 'Notes: a/b "draft" ' }), "png")).toBe(
      "Notes a b draft.png",
    );
    expect(downloadFilename(image({ title: "..." }), "png")).toBe(`${ID}.png`);
  });

  test("a URL that isn't http(s) is not a name", () => {
    const captured = image({ sourceImageUrl: "data:image/png;base64,iVBORw0", title: "Pasted" });
    expect(downloadFilename(captured, "png")).toBe("Pasted.png");
  });
});

describe("contentDisposition", () => {
  test("keeps the file inline and names it", () => {
    expect(contentDisposition("stairwell.jpg")).toBe(
      `inline; filename="stairwell.jpg"; filename*=UTF-8''stairwell.jpg`,
    );
  });

  test("carries a non-ASCII name in UTF-8, with an ASCII stand-in", () => {
    expect(contentDisposition("Café (1).png")).toBe(
      `inline; filename="Caf_ (1).png"; filename*=UTF-8''Caf%C3%A9%20%281%29.png`,
    );
  });
});
