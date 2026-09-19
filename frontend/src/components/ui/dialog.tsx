"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return (
    <DialogPrimitive.Portal {...props}>
      <div data-slot="dialog-portal" className="vk-dialog-stack">
        {children}
        <div data-slot="dialog-vk-slot" className="vk-dialog-vk-slot" />
      </div>
    </DialogPrimitive.Portal>
  )
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "absolute inset-0 isolate z-0 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Radix wertet Taps auf die virtuelle Tastatur als "Outside" —
 * die Tastatur liegt in einem eigenen Portal außerhalb des Dialogs.
 * Nur dann schließen verhindern, wenn der echte Target in der Tastatur
 * oder einem Select/Popover liegt — nicht pauschal bei body.vk-open.
 */
function shouldBlockOutsideDismiss(event: unknown): boolean {
  // Select-Dropdown liegt im Portal außerhalb des Dialogs. Solange es offen ist
  // oder der Tap in Tastatur/Select landet, Dialog nicht schließen.
  if (typeof document !== "undefined") {
    if (document.querySelector('[data-slot="select-content"][data-state="open"], [data-radix-select-content][data-state="open"]')) {
      return true
    }
  }
  const e = event as {
    target?: EventTarget | null
    detail?: { originalEvent?: Event }
  }
  const originalTarget = e.detail?.originalEvent?.target ?? e.target ?? null
  if (originalTarget instanceof Element) {
    if (originalTarget.closest("[data-vk-root]")) {
      return true
    }
    if (
      originalTarget.closest("[data-slot='select-content']") ||
      originalTarget.closest("[data-slot='select-item']") ||
      originalTarget.closest("[data-slot='select-trigger']") ||
      originalTarget.closest("[data-radix-select-content]") ||
      originalTarget.closest("[data-radix-popper-content-wrapper]")
    ) {
      return true
    }
  }
  return false
}

function blockOutside(
  e: { preventDefault(): void },
  event: unknown,
) {
  if (shouldBlockOutsideDismiss(event)) e.preventDefault()
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onPointerDownOutside,
  onInteractOutside,
  onFocusOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <div data-slot="dialog-stack-main" className="vk-dialog-stack-main">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "z-10 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
          onPointerDownOutside={(e) => {
            blockOutside(e, e)
            onPointerDownOutside?.(e)
          }}
          onInteractOutside={(e) => {
            blockOutside(e, e)
            onInteractOutside?.(e)
          }}
          onFocusOutside={(e) => {
            blockOutside(e, e)
            onFocusOutside?.(e)
          }}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
