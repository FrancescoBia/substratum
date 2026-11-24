import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@repo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";

const meta = {
  title: "Components/Tooltip",
  component: TooltipContent,
  args: { children: "Add to board", side: "top" },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "right", "bottom", "left"] },
  },
  render: (args) => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
      <TooltipContent {...args} />
    </Tooltip>
  ),
} satisfies Meta<typeof TooltipContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  render: (args) => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline">Trigger</Button>} />
      <TooltipContent {...args} />
    </Tooltip>
  ),
};
