import type { Meta, StoryObj } from "@storybook/react-vite";

import { Label } from "@repo/ui/components/label";
import { Switch } from "@repo/ui/components/switch";

const meta = {
  title: "Components/Switch",
  component: Switch,
  argTypes: {
    defaultChecked: { control: "boolean" },
    disabled: { control: "boolean" },
    size: { control: "inline-radio", options: ["default", "sm"] },
  },
  render: (args) => (
    <Label>
      <Switch {...args} />
      Public URL
    </Label>
  ),
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
