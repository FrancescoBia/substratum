import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

const meta = {
  title: "Components/Card",
  component: Card,
  argTypes: {
    size: { control: "select", options: ["default", "sm"] },
  },
  render: (args) => (
    <Card {...args} className="max-w-sm">
      <CardHeader>
        <CardTitle>Moodboard</CardTitle>
        <CardDescription>42 items · updated today</CardDescription>
        <CardAction>
          <Button size="sm" variant="ghost">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>Reference images for the spring campaign.</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Share</Button>
        <Button>Open</Button>
      </CardFooter>
    </Card>
  ),
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: "sm" },
};
