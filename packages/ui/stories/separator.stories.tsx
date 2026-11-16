import type { Meta, StoryObj } from "@storybook/react-vite";

import { Separator } from "@repo/ui/components/separator";

const meta = {
  title: "Components/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <div className="flex max-w-xs flex-col gap-3 text-sm">
      <span>Library</span>
      <Separator {...args} />
      <span>Trash</span>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Images</span>
      <Separator {...args} />
      <span>Videos</span>
      <Separator {...args} />
      <span>Boards</span>
    </div>
  ),
};
