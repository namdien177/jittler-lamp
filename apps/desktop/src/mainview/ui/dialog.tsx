import React, { useEffect } from "react";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnOverlay?: boolean;
};

export function Dialog(props: DialogProps): React.JSX.Element | null {
  const { open, onClose, title, description, children, footer, size = "md", closeOnOverlay = true } = props;

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-overlay"
      role="presentation"
      onClick={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="ui-dialog" data-size={size} role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <div className="ui-dialog-header">
          <div>
            <h2 className="ui-dialog-title" id="ui-dialog-title">
              {title}
            </h2>
            {description ? <p className="ui-dialog-description">{description}</p> : null}
          </div>
          <button className="ui-dialog-close" type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
      </div>
    </div>
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
          <button className="button ghost sm" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={destructive ? "button danger sm" : "button primary sm"}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <span className="muted">{description}</span>
    </Dialog>
  );
}
