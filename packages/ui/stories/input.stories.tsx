import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "@repo/ui/components/input";

const meta = {
  title: "Components/Input",
  component: Input,
  args: { placeholder: "Search your library…" },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "not a url" },
};

export const File: Story = {
  args: { type: "file" },
};
