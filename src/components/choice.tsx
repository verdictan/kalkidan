import { cn } from '../lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
export function Choice({
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value || '__none'}
      onValueChange={(value) => onChange(value === '__none' ? '' : value)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          'min-w-0 max-w-full [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate',
          className,
        )}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]">
        {options.map((option) => (
          <SelectItem
            className="whitespace-normal break-words"
            key={option.value || '__none'}
            value={option.value || '__none'}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
