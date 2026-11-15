import * as React from "react"
import { cn, textareaBase, useFieldAria } from "@/components/ui/primitives"

/** Multi-line text with the same outline, fill and focus ring as Input. A class passed in wins over the defaults. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const aria = useFieldAria(props)
  return <textarea data-slot="textarea" className={cn(textareaBase, "field-sizing-content", className)} {...props} {...aria} />
}

export { Textarea }
