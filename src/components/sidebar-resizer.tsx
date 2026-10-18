import { useRef, useState } from 'react';
export function SidebarResizer({
  width,
  min,
  maximum,
  initial,
  update,
}: {
  width: number;
  min: number;
  maximum: number;
  initial: number;
  update: (value: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={'sidebar-resizer' + (dragging ? ' dragging' : '')}
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize sidebar. Double-click to reset."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (drag.current) update(drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => update(initial)}
      onKeyDown={(e) => {
        const value =
          e.key === 'ArrowLeft'
            ? width - 10
            : e.key === 'ArrowRight'
              ? width + 10
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? maximum
                  : null;
        if (value !== null) {
          e.preventDefault();
          update(value);
        }
      }}
    />
  );
}
