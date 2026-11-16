import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@repo/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet";

type Side = "top" | "right" | "bottom" | "left";

function SheetExample({ side }: { side: Side }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open {side}</SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>Details</SheetTitle>
          <SheetDescription>Metadata for the selected item.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: "Components/Sheet",
  component: SheetExample,
  args: { side: "right" },
  argTypes: {
    side: { control: "select", options: ["top", "right", "bottom", "left"] },
  },
} satisfies Meta<typeof SheetExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllSides: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <SheetExample key={side} side={side} />
      ))}
    </div>
  ),
};
