import type React from "react";
import { useRef, useState } from "react";

export function useWebFileAdapter(args: { disabled: boolean; onFile: (file: File) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  return {
    inputRef,
    isDragOver,
    openDialog: (): void => {
      if (args.disabled) return;
      inputRef.current?.click();
    },
    onInputChange: (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.currentTarget.files?.[0];
      if (file) void args.onFile(file);
      event.currentTarget.value = "";
    },
    onDragOver: (event: React.DragEvent<HTMLElement>): void => {
      if (args.disabled) return;
      event.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: (): void => setIsDragOver(false),
    onDrop: (event: React.DragEvent<HTMLElement>): void => {
      event.preventDefault();
      setIsDragOver(false);
      if (args.disabled) return;
      const file = event.dataTransfer.files[0];
      if (file) void args.onFile(file);
    }
  };
}
