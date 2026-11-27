import { type RefObject, useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import { moveFocus } from "~/lib/move-focus";
import type { action } from "~/routes/boards";

/**
 * Creates a board and opens it once the list has it, so its row arrives
 * unselected and the selection plays on it like any other. Focus follows to its
 * row, unless the person has already moved it out of the Add Board field.
 */
export const useCreateBoard = (listRef: RefObject<HTMLElement | null>) => {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const quiet = useRef(false);
  const opened = useRef<unknown>(null);

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data || !("id" in data) || opened.current === data) return;
    opened.current = data;
    navigate(`/boards/${data.id}`);

    const row = listRef.current?.querySelector<HTMLElement>(`a[href="/boards/${data.id}"]`);
    const focusInField = document.activeElement?.closest(".add-board");
    if (row && focusInField) moveFocus(row, { quiet: quiet.current });
  }, [fetcher.state, fetcher.data, navigate, listRef]);

  return (name: string, options: { quiet: boolean }) => {
    quiet.current = options.quiet;
    void fetcher.submit({ intent: "create", name }, { method: "post", action: "/boards" });
  };
};
