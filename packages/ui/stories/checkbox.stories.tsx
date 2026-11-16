import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "@repo/ui/components/checkbox";
import { Label } from "@repo/ui/components/label";

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  argTypes: {
    defaultChecked: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  render: (args) => (
    <Label>
      <Checkbox {...args} />
      Make board public
    </Label>
  ),
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
