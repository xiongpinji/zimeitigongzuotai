export interface Viewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AutoScrollArgs {
  x: number;
  y: number;
  viewport: Viewport;
  hotzone: number;
  maxSpeed: number;
  dtMs: number;
}

export interface AutoScrollDelta {
  dx: number;
  dy: number;
}

function axisDelta(
  pointer: number,
  near: number,
  far: number,
  hotzone: number,
  maxSpeed: number,
  dtMs: number,
): number {
  if (pointer < near) return 0;
  if (pointer > far) return 0;

  const distFromNear = pointer - near;
  const distFromFar = far - pointer;

  let dir = 0;
  let depth = 0;

  if (distFromNear < hotzone) {
    dir = -1;
    depth = hotzone - distFromNear;
  } else if (distFromFar < hotzone) {
    dir = 1;
    depth = hotzone - distFromFar;
  } else {
    return 0;
  }

  const ratio = Math.min(1, Math.max(0, depth / hotzone));
  const speed = maxSpeed * ratio;
  return (dir * speed * dtMs) / 1000;
}

export function computeAutoScrollDelta(args: AutoScrollArgs): AutoScrollDelta {
  const { x, y, viewport, hotzone, maxSpeed, dtMs } = args;
  return {
    dx: axisDelta(x, viewport.left, viewport.right, hotzone, maxSpeed, dtMs),
    dy: axisDelta(y, viewport.top, viewport.bottom, hotzone, maxSpeed, dtMs),
  };
}

// Scheduler — 暴露给组件层使用
export interface AutoScrollScheduler {
  update(pointer: { x: number; y: number }): void;
  stop(): void;
}

export interface StartAutoScrollArgs {
  container: HTMLElement;
  hotzone?: number;
  maxSpeed?: number;
}

export function startAutoScroll({
  container,
  hotzone = 40,
  maxSpeed = 800,
}: StartAutoScrollArgs): AutoScrollScheduler {
  let pointer: { x: number; y: number } | null = null;
  let rafId: number | null = null;
  let lastTs = performance.now();

  const tick = (ts: number) => {
    const dt = Math.min(64, ts - lastTs);
    lastTs = ts;

    if (pointer) {
      const rect = container.getBoundingClientRect();
      const delta = computeAutoScrollDelta({
        x: pointer.x,
        y: pointer.y,
        viewport: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
        hotzone,
        maxSpeed,
        dtMs: dt,
      });
      if (delta.dx !== 0) container.scrollLeft += delta.dx;
      if (delta.dy !== 0) container.scrollTop += delta.dy;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    update(next) {
      pointer = next;
    },
    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pointer = null;
    },
  };
}
