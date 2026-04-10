"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-1 text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:border-0",
  {
    variants: {
      variant: {
        // IO brand pill track: slate surface, thin hairline, nav-like feel.
        default:
          "bg-muted border border-border ring-1 ring-inset ring-border-subtle",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // Base
        "relative inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-[0.8125rem] font-semibold whitespace-nowrap",
        "text-muted-foreground transition-all duration-[var(--dur-fast)] ease-[cubic-bezier(0.2,0,0,1)]",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        // Hover
        "hover:text-foreground hover:bg-[color-mix(in_oklab,var(--primary)_6%,transparent)]",
        // Focus
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        // Icon sizing
        "has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // IO brand: navy active pill (default variant)
        "group-data-[variant=default]/tabs-list:data-active:bg-primary",
        "group-data-[variant=default]/tabs-list:data-active:text-primary-foreground",
        "group-data-[variant=default]/tabs-list:data-active:shadow-elev-1",
        // Line variant: underline instead of pill
        "group-data-[variant=line]/tabs-list:bg-transparent",
        "group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=line]/tabs-list:data-active:text-foreground",
        // Underline pseudo for line variant only
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity",
        "group-data-horizontal/tabs:after:inset-x-3 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-[2px]",
        "group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-[2px]",
        "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        "group-data-[variant=default]/tabs-list:after:hidden",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
