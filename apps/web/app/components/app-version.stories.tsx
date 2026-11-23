import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { AppVersion } from "~/components/app-version";

// The sidebar's footer row, with room above it for the popover to open into.
const inSidebarFooter: Decorator = (Story) => (
  <div className="flex h-48 items-end">
    <div className="bg-sidebar text-muted-foreground flex w-70 items-center justify-end px-3 py-2">
      <Story />
    </div>
  </div>
);

const meta = {
  title: "Web/AppVersion",
  component: AppVersion,
  decorators: [inSidebarFooter],
} satisfies Meta<typeof AppVersion>;

export default meta;
type Story = StoryObj<typeof meta>;

const update = {
  version: "9.9.9",
  url: "https://github.com/FrancescoBia/substratum/releases/latest",
};

export const UpToDate: Story = {
  args: { update: null },
};

export const UpdateAvailable: Story = {
  args: { update },
};

export const UpdateAvailableOpen: Story = {
  args: { update },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button"));
  },
};
