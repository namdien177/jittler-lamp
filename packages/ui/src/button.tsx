import React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  iconOnly?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "danger" | "ghost" | "outline" | "primary" | "secondary";
};

export function Button(props: ButtonProps): React.JSX.Element {
  const { className, iconOnly, size, variant, type = "button", ...buttonProps } = props;
  const classes = [
    "ui-button",
    variant ? `ui-button-${variant}` : null,
    size && size !== "md" ? `ui-button-${size}` : null,
    iconOnly ? "ui-button-icon-only" : null,
    className
  ].filter(Boolean).join(" ");

  return <button {...buttonProps} className={classes} type={type} />;
}
