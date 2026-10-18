import { useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { Button } from './ui/button';
import { Hint } from './hint';

export function SessionPin({
  pinned,
  disabled,
  onToggle,
}: {
  pinned: boolean;
  disabled: boolean;
  onToggle: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const label = pinned ? 'Unpin session' : 'Pin session';
  return (
    <>
      <Hint label={disabled ? 'Send a message before pinning this session' : label}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pinned}
          disabled={disabled || saving}
          onClick={async () => {
            setSaving(true);
            setError('');
            try {
              await onToggle();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </Button>
      </Hint>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
