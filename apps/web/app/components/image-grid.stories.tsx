import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { createRoutesStub } from "react-router";

import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import type { GridImage } from "~/lib/library.server";

/**
 * ImageGrid reads the location and links with `?view=`, so it needs a router.
 * The stub is an in-memory one: clicking a tile opens the lightbox for real.
 * Without a `routes/library` route there is no selection, so the viewer's
 * details panel stays empty — that panel gets its own stories.
 */
const withRouter: Decorator = (Story) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => <Story /> }]);
  return <Stub initialEntries={["/"]} />;
};

// `id` names a file in apps/storybook/fixtures, served at `/img/<id>/<variant>`.
function fixture(id: string, width: number, height: number, title: string | null): GridImage {
  return {
    id,
    kind: "image",
    width,
    height,
    durationMs: null,
    title,
    sourcePageUrl: null,
    untriaged: false,
  };
}

const images: GridImage[] = [
  fixture("landscape", 1600, 1000, "Landscape"),
  fixture("portrait", 1000, 1500, "Portrait"),
  fixture("square", 1200, 1200, null),
  fixture("wide", 2000, 800, "Panorama"),
  fixture("tall", 900, 1800, "Tall"),
  fixture("classic", 1500, 1125, null),
];

const meta = {
  title: "Web/ImageGrid",
  component: ImageGrid,
  decorators: [withRouter],
  parameters: { layout: "padded" },
  args: { images, layout: "flat" },
} satisfies Meta<typeof ImageGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHeader: Story = {
  render: (args) => (
    <>
      <ViewHeader title="Stream" subtitle={`${args.images.length} items`} />
      <ImageGrid {...args} />
    </>
  ),
};

export const Empty: Story = {
  args: { images: [] },
  render: () => (
    <EmptyState title="Nothing here yet">
      Drop images anywhere on the page, or save them with the browser extension.
    </EmptyState>
  ),
};
