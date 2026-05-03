import React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption<TValue extends string> = {
  label: string;
  value: TValue;
};

export function UiSelect<TValue extends string>(props: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<SelectOption<TValue>>;
  value: TValue;
  onValueChange: (value: TValue) => void;
}): React.JSX.Element {
  const { ariaLabel, className, disabled, options, value, onValueChange } = props;

  return (
    <BaseSelect.Root
      items={options}
      value={value}
      {...(disabled !== undefined ? { disabled } : {})}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onValueChange(nextValue as TValue);
      }}
    >
      <BaseSelect.Trigger className={["ui-select-trigger", className].filter(Boolean).join(" ")} type="button" aria-label={ariaLabel}>
        <BaseSelect.Value className="ui-select-value" />
        <BaseSelect.Icon className="ui-select-icon">
          <ChevronDown aria-hidden size={14} strokeWidth={2} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="ui-select-positioner" alignItemWithTrigger={false} sideOffset={4}>
          <BaseSelect.Popup className="ui-select-popup">
            <BaseSelect.List className="ui-select-list">
              {options.map((option) => (
                <BaseSelect.Item key={option.value} className="ui-select-item" value={option.value}>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ui-select-item-indicator">
                    <Check aria-hidden size={13} strokeWidth={2} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
