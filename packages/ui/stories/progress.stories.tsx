import type { Meta, StoryObj } from "@storybook/react-vite";

import { Progress, ProgressLabel, ProgressValue } from "@repo/ui/components/progress";

const meta = {
  title: "Components/Progress",
  component: Progress,
  args: { value: 60 },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100 } },
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <Progress {...args}>
      <ProgressLabel>Uploading 3 files</ProgressLabel>
      <ProgressValue />
    </Progress>
  ),
};

export const Indeterminate: Story = {
  args: { value: null },
};
