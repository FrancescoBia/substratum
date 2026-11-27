import { useState } from "react";

/**
 * Ids that weren't in the list on the previous render. The first render counts
 * nothing as new, so the list doesn't animate in on load.
 */
export const useEnteringIds = (ids: string[]) => {
  const [known, setKnown] = useState(() => new Set(ids));
  const [entering, setEntering] = useState(() => new Set<string>());
  const added = ids.filter((id) => !known.has(id));
  if (added.length > 0) {
    setKnown(new Set(ids));
    setEntering(new Set([...entering, ...added]));
  }
  return entering;
};
