import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";

const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Item</DropdownMenuLabel>
          <DropdownMenuItem>
            <PencilIcon />
            Rename
            <DropdownMenuShortcut>R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <DownloadIcon />
            Download
            <DropdownMenuShortcut>D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add to board</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Spring campaign</DropdownMenuItem>
              <DropdownMenuItem>Typography</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <TrashIcon />
          Move to trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

function SelectionMenu() {
  const [showVideos, setShowVideos] = useState(true);
  const [sort, setSort] = useState("newest");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>View</DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={showVideos} onCheckedChange={setShowVideos}>
            Videos
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
            <DropdownMenuRadioItem value="newest">Newest</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">Oldest</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const CheckboxAndRadio: Story = {
  render: () => <SelectionMenu />,
};

function BoardSettingsMenu() {
  const [layout, setLayout] = useState("flat");

  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Board settings">
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem>
          <PencilIcon /> Rename board
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LayoutGridIcon /> Display
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup value={layout} onValueChange={setLayout}>
              <DropdownMenuRadioItem value="flat">
                <LayoutGridIcon /> Grid view
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mosaic">
                <LayoutDashboardIcon /> Mosaic view
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <TrashIcon /> Delete board
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const BoardSettings: Story = {
  render: () => (
    <div className="flex w-80 justify-end">
      <BoardSettingsMenu />
    </div>
  ),
};

type PlacementArgs = {
  side: "top" | "bottom" | "left" | "right";
  align: "start" | "center" | "end";
  sideOffset: number;
  alignOffset: number;
};

export const Placement: StoryObj<PlacementArgs> = {
  args: { side: "bottom", align: "start", sideOffset: 4, alignOffset: 0 },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "bottom", "left", "right"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    sideOffset: { control: { type: "range", min: 0, max: 32 } },
    alignOffset: { control: { type: "range", min: -32, max: 32 } },
  },
  render: (args) => (
    <div className="flex h-80 w-96 items-center justify-center">
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
        <DropdownMenuContent className="w-40" {...args}>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Download</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>With icons</DropdownMenuLabel>
          <DropdownMenuItem>
            <CopyIcon /> Copy link
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <GlobeIcon /> Publish (disabled)
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel inset>Inset</DropdownMenuLabel>
          <DropdownMenuItem inset>No icon, aligned</DropdownMenuItem>
          <DropdownMenuItem inset disabled>
            Disabled inset
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked inset>
            Checked
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <TrashIcon /> Destructive
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled>
          <TrashIcon /> Destructive disabled
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const NestedSubmenus: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Move to</DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        <DropdownMenuItem>Stream</DropdownMenuItem>
        <DropdownMenuSub defaultOpen>
          <DropdownMenuSubTrigger>Boards</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Spring campaign</DropdownMenuItem>
            <DropdownMenuSub defaultOpen>
              <DropdownMenuSubTrigger>Archive</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>2025</DropdownMenuItem>
                <DropdownMenuItem>2024</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const LongList: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Add to board</DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-64 w-56">
        {Array.from({ length: 30 }, (_, index) => (
          <DropdownMenuItem key={index}>
            {index === 3
              ? "A board with a very long name that should truncate or wrap"
              : `Board ${index + 1}`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
