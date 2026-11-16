import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";

const meta = {
  title: "Components/Field",
  component: Field,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Field {...args}>
      <FieldLabel htmlFor="board-name">Board name</FieldLabel>
      <Input id="board-name" placeholder="Spring campaign" />
      <FieldDescription>Shown in the sidebar and on the public page.</FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: (args) => (
    <Field {...args} data-invalid="true">
      <FieldLabel htmlFor="password">Password</FieldLabel>
      <Input id="password" type="password" aria-invalid />
      <FieldError errors={[{ message: "Must be at least 12 characters." }]} />
    </Field>
  ),
};

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  render: (args) => (
    <Field {...args}>
      <Checkbox id="public" />
      <FieldContent>
        <FieldLabel htmlFor="public">Public board</FieldLabel>
        <FieldDescription>Anyone with the link can view it.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};

export const Form: Story = {
  render: () => (
    <form onSubmit={(event) => event.preventDefault()}>
      <FieldSet>
        <FieldLegend>New board</FieldLegend>
        <FieldDescription>Boards group items from your library.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="form-name">Name</FieldLabel>
            <Input id="form-name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="form-notes">Notes</FieldLabel>
            <Textarea id="form-notes" />
          </Field>
          <FieldSeparator />
          <Field orientation="horizontal">
            <Button type="submit">Create</Button>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  ),
};
