"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// A polished, localized replacement for window.confirm. Controlled: the parent owns
// `open` and is called back with the chosen action. Supports up to two action buttons
// plus cancel (e.g. "Crop" / "Upload as-is" / Cancel), and a destructive primary.
export type ConfirmDialogAction = {
  label: string;
  // Visual variant for the button; "destructive" for irreversible actions.
  variant?: "default" | "destructive" | "outline" | "secondary";
  onClick: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  cancelLabel: string;
  // One or more action buttons rendered after Cancel (last is the primary/right-most).
  actions: ConfirmDialogAction[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant ?? "default"}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
