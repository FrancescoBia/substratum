import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contentDisposition, downloadFilename, type NamedImage } from "../app/lib/download-name.ts";

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
    assert.equal(downloadFilename(image({ filename: "IMG_0042.JPG" }), "jpeg"), "IMG_0042.JPG");
    assert.equal(downloadFilename(image({ filename: "stairwell.jpeg" }), "jpeg"), "stairwell.jpeg");
  });

  test("a capture is named for the last segment of the URL it came from", () => {
    const captured = image({
      sourceImageUrl: "https://cdn.example.com/photos/brutalist%20stairwell.png?w=1200",
      title: "Renamed by the Owner",
      sourcePageTitle: "Some page",
    });
    assert.equal(downloadFilename(captured, "png"), "brutalist stairwell.png");
  });

  test("an extension for another format is replaced, not doubled", () => {
    const captured = image({ sourceImageUrl: "https://example.com/hero.jpg" });
    assert.equal(downloadFilename(captured, "webp"), "hero.webp");
    assert.equal(downloadFilename(image({ filename: "clip.MOV" }), "mp4"), "clip.mp4");
  });

  test("a name with no extension, or a non-media one, gets the right one appended", () => {
    const captured = image({ sourceImageUrl: "https://images.example.com/abc123" });
    assert.equal(downloadFilename(captured, "avif"), "abc123.avif");
    assert.equal(downloadFilename(image({ filename: "v1.2 final" }), "png"), "v1.2 final.png");
  });

  test("with no filename or URL name, the title stands in, then the id", () => {
    assert.equal(
      downloadFilename(image({ sourceImageUrl: "https://example.com/", title: "Wave" }), "gif"),
      "Wave.gif",
    );
    assert.equal(downloadFilename(image({ sourcePageTitle: "A page" }), "jpeg"), "A page.jpg");
    assert.equal(downloadFilename(image({}), "jpeg"), `${ID}.jpg`);
  });

  test("characters no file system takes are dropped", () => {
    assert.equal(
      downloadFilename(image({ title: 'Notes: a/b "draft" ' }), "png"),
      "Notes a b draft.png",
    );
    assert.equal(downloadFilename(image({ title: "..." }), "png"), `${ID}.png`);
  });

  test("a URL that isn't http(s) is not a name", () => {
    const captured = image({ sourceImageUrl: "data:image/png;base64,iVBORw0", title: "Pasted" });
    assert.equal(downloadFilename(captured, "png"), "Pasted.png");
  });
});

describe("contentDisposition", () => {
  test("keeps the file inline and names it", () => {
    assert.equal(
      contentDisposition("stairwell.jpg"),
      `inline; filename="stairwell.jpg"; filename*=UTF-8''stairwell.jpg`,
    );
  });

  test("carries a non-ASCII name in UTF-8, with an ASCII stand-in", () => {
    assert.equal(
      contentDisposition("Café (1).png"),
      `inline; filename="Caf_ (1).png"; filename*=UTF-8''Caf%C3%A9%20%281%29.png`,
    );
  });
});
