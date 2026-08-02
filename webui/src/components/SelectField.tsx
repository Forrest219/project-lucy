import * as Select from "@radix-ui/react-select";
import clsx from "clsx";

type Option = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  translate?: "yes" | "no";
};

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function SelectField({ value, onValueChange, options, placeholder, ariaLabel, className, translate }: Props) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className={clsx("pl-select-trigger inline-flex items-center justify-between gap-2", className)}
        aria-label={ariaLabel}
        translate={translate}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="text-fg-muted">
          <ChevronIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="pl-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="pl-select-viewport">
            {options.map((option) => (
              <Select.Item key={option.value} value={option.value} className="pl-select-item">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className={clsx("ml-auto text-primary")}>
                  <CheckIcon />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
