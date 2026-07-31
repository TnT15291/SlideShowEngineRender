import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// `disabled:opacity-50` alone was not readable as "disabled": half-strength
// primary brown on the cream background still lands on a solid tan that looks
// like an ordinary button, so people clicked Sign in / Continue and nothing
// happened. A flat muted fill reads as unavailable at a glance instead. The
// `disabled:` modifier adds a pseudo-class, so these win over the variant
// colours below without needing !important.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:shadow-none",
  {
    variants: {
      // Each variant states its own disabled colours rather than sharing one
      // rule in the base: conflicting `disabled:` utilities have equal
      // specificity, so which one wins would come down to stylesheet order.
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/70",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground/70",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground/70",
        ghost: "hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/60",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground/70",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

function Button({ className, variant, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
