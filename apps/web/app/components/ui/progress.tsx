import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "~/lib/utils"

/**
 * Pass `value={null}` for an indeterminate bar: Radix flips `data-state` to
 * "indeterminate" and the indicator sweeps instead of filling.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full bg-primary transition-transform duration-300 ease-out data-[state=indeterminate]:w-2/5 data-[state=indeterminate]:animate-progress-sweep"
        style={value == null ? undefined : { transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
