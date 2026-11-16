import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlertIcon, InfoIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";

const meta = {
  title: "Components/Alert",
  component: Alert,
  argTypes: {
    variant: { control: "select", options: ["default", "destructive"] },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>Capture saved</AlertTitle>
      <AlertDescription>The image was added to your library.</AlertDescription>
    </Alert>
  ),
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <Alert {...args}>
      <CircleAlertIcon />
      <AlertTitle>Upload failed</AlertTitle>
      <AlertDescription>The file is not a supported image or video.</AlertDescription>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>3 items in trash</AlertTitle>
      <AlertDescription>They are deleted for good after 30 days.</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          Empty
        </Button>
      </AlertAction>
    </Alert>
  ),
};
