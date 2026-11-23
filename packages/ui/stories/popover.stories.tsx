import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";

const meta = {
  title: "Components/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger>
      <PopoverContent className="space-y-1">
        <p className="font-medium">Popover title</p>
        <p className="text-xs text-muted-foreground">
          Short supporting text. Click outside or press Escape to close.
        </p>
      </PopoverContent>
    </Popover>
  ),
};

export const Sides: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-4 p-24">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Popover key={side} {...args}>
          <PopoverTrigger render={<Button variant="outline" />}>{side}</PopoverTrigger>
          <PopoverContent side={side} className="w-auto">
            Opens on the {side}
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};
