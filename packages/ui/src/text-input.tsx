import React from "react";

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(props, ref) {
  const { className, mono, type = "text", ...inputProps } = props;
  const classes = ["ui-input", mono ? "ui-input-mono" : null, className].filter(Boolean).join(" ");

  return <input {...inputProps} ref={ref} className={classes} type={type} />;
});
