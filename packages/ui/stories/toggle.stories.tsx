import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoldIcon, LayoutDashboard } from "lucide-react";

import { Toggle } from "@repo/ui/components/toggle";

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  args: { "aria-label": "Bold", children: <BoldIcon /> },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "outline"] },
    size: { control: "inline-radio", options: ["default", "sm", "lg"] },
    defaultPressed: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pressed: Story = {
  args: { defaultPressed: true },
};

export const Outline: Story = {
  args: { variant: "outline" },
};

export const WithText: Story = {
  args: {
    "aria-label": undefined,
    children: (
      <>
        <LayoutDashboard /> Mosaic
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
