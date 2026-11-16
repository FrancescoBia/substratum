import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Separator } from "@repo/ui/components/separator";

const tags = Array.from({ length: 40 }, (_, i) => `tag-${i + 1}`);

const meta = {
  title: "Components/ScrollArea",
  component: ScrollArea,
  render: (args) => (
    <ScrollArea {...args} className="h-64 w-48 rounded-lg border">
      <div className="p-3 text-sm">
        {tags.map((tag, i) => (
          <div key={tag}>
            {i > 0 && <Separator className="my-2" />}
            {tag}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
