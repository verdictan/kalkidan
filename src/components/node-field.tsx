import { useEffect, useRef } from 'react';

/** A small fixed random source, so the graph has the same shape on each launch. */
function random(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

interface Node {
  x: number;
  y: number;
  phase: number;
  hub: boolean;
}

/**
 * A faint graph of nodes and edges in two corners of a focus page (Welcome, sign-in, the empty
 * Projects page), as if agents were at work. The middle stays clear, so the main action stays the
 * focal point. The nodes pulse slowly. They stop when the window is hidden and stay still with
 * reduced motion. The edges use the text color and the hubs use the primary color of the theme.
 */
export function NodeField({
  corners = 'opposite',
}: {
  /** 'opposite': top left and bottom right. 'bottom': both bottom corners, below a page title. */
  corners?: 'opposite' | 'bottom';
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const style = getComputedStyle(element);
    const ink = style.getPropertyValue('--foreground').trim() || '#171717';
    const hub = style.getPropertyValue('--primary').trim() || '#9a4600';
    let nodes: Node[] = [];
    let time = 0;
    let frame = 0;
    function layout(width: number, height: number) {
      const next = random(7);
      nodes = [];
      // Sixteen nodes in each of two corners.
      const anchors =
        corners === 'bottom'
          ? [
              [0, height],
              [width, height],
            ]
          : [
              [0, 0],
              [width, height],
            ];
      for (const [x, y] of anchors)
        for (let i = 0; i < 16; i++)
          nodes.push({
            x: x + (x ? -1 : 1) * next() * width * 0.36,
            y: y + (y ? -1 : 1) * next() * height * 0.42,
            phase: next() * Math.PI * 2,
            hub: next() < 0.12,
          });
    }
    function draw() {
      if (!element || !context) return;
      const box = element.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(box.width * ratio);
      const height = Math.round(box.height * ratio);
      if (!width || !height) return;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
        layout(width, height);
      }
      context.clearRect(0, 0, width, height);
      const reach = Math.min(width, height) * 0.2;
      context.lineWidth = ratio;
      context.strokeStyle = ink;
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance >= reach) continue;
          context.globalAlpha = 0.09 * (1 - distance / reach);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      for (const node of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin(time + node.phase);
        context.globalAlpha = node.hub ? 0.35 + 0.35 * pulse : 0.12 + 0.12 * pulse;
        context.fillStyle = node.hub ? hub : ink;
        context.beginPath();
        context.arc(node.x, node.y, (node.hub ? 3 : 2) * ratio, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    }
    function loop() {
      if (!document.hidden) {
        time += 0.02;
        draw();
      }
      frame = requestAnimationFrame(loop);
    }
    draw();
    if (!still) frame = requestAnimationFrame(loop);
    const resize = new ResizeObserver(() => draw());
    resize.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [corners]);
  return <canvas ref={canvas} className="node-field" aria-hidden="true" />;
}
