import React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { Button } from "./button";

export type DialogProps = {
  open?: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnOverlay?: boolean;
};

export function Dialog(props: DialogProps): React.JSX.Element | null {
  const { open = true, onClose, title, description, children, footer, size = "md", closeOnOverlay = true } = props;

  if (!open) return null;

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      disablePointerDismissal={!closeOnOverlay}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ui-dialog-backdrop" />
        <BaseDialog.Viewport className="ui-dialog-viewport">
          <BaseDialog.Popup className="ui-dialog" data-size={size}>
            <div className="ui-dialog-header">
              <div>
                <BaseDialog.Title className="ui-dialog-title">{title}</BaseDialog.Title>
                {description ? <BaseDialog.Description className="ui-dialog-description">{description}</BaseDialog.Description> : null}
              </div>
              <BaseDialog.Close className="ui-dialog-close" type="button" aria-label="Close">
                <X aria-hidden size={16} strokeWidth={2} />
              </BaseDialog.Close>
            </div>
            <div className="ui-dialog-body">{children}</div>
            {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element | null {
  const {
    open,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    busy,
    onConfirm,
    onCancel
  } = props;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      {...(description !== undefined ? { description } : {})}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </Button>
        </>
      }
    >
      <span className="muted">{description}</span>
    </Dialog>
  );
}
