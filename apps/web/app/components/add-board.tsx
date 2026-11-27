import { PlusCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PAUSE_MS = 300;

export const AddBoard = ({
  onCreate,
  onOpenChange,
}: {
  onCreate: (name: string) => void;
  onOpenChange?: (open: boolean) => void;
}) => {
  const [open, setOpenState] = useState(false);
  const [name, setName] = useState("");
  const [paused, setPaused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filled = name.trim().length > 0;

  // Enter submits as soon as there's a name; the button waits for a pause in
  // typing so it doesn't spring up on the first keystroke.
  useEffect(() => {
    if (!open || !filled || paused) return;
    const timer = window.setTimeout(() => setPaused(true), PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, name, filled, paused]);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const close = () => {
    setOpen(false);
    setName("");
    setPaused(false);
  };

  const cancel = () => {
    close();
    triggerRef.current?.focus();
  };

  const showConfirm = open && filled && paused;

  return (
    <form
      ref={formRef}
      method="post"
      action="/boards"
      data-open={open || undefined}
      className="add-board relative h-8 rounded-lg border text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!filled) {
          inputRef.current?.focus();
          return;
        }
        onCreate(name.trim());
        cancel();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        tabIndex={open ? -1 : 0}
        aria-hidden={open}
        aria-label="Add Board"
        className="add-board-trigger absolute inset-0 rounded-[inherit] outline-none"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      />

      <span
        aria-hidden
        className="add-board-text pointer-events-none absolute inset-y-0 left-2.5 flex items-center whitespace-nowrap"
      >
        <PlusCircleIcon className="add-board-icon size-icon absolute top-1/2 right-full mr-1.5 -translate-y-1/2" />
        <span className="add-board-label">Add Board</span>
        <span
          className="add-board-placeholder absolute top-1/2 left-0 -translate-y-1/2"
          style={{ visibility: open && name ? "hidden" : undefined }}
        >
          Board name…
        </span>
      </span>

      <input
        ref={inputRef}
        name="name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (!event.target.value.trim()) setPaused(false);
        }}
        placeholder="Board name…"
        aria-label="Board name"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        autoComplete="off"
        className="add-board-input text-foreground absolute inset-0 bg-transparent pr-9 pl-2.5 outline-none placeholder:text-transparent"
        onBlur={(event) => {
          if (event.relatedTarget && formRef.current?.contains(event.relatedTarget)) return;
          if (!filled) close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
      />

      <button
        type="submit"
        aria-label="Create board"
        tabIndex={showConfirm ? 0 : -1}
        aria-hidden={!showConfirm}
        data-show={showConfirm || undefined}
        className="add-board-confirm bg-primary text-primary-foreground focus-visible:ring-ring/50 absolute top-[3px] right-[3px] grid size-6 place-items-center rounded-md outline-none focus-visible:ring-3"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5"
          aria-hidden
        >
          <path className="add-board-tick" d="M4 12l5 5L20 6" pathLength={1} />
        </svg>
      </button>
    </form>
  );
};
