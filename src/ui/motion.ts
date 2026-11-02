const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const running = new WeakMap<HTMLElement, { shown: number; frame: number }>();

const defaultFormat = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
export const whole = (value: number) => Math.round(value).toLocaleString();

/**
 * Animates a number from what the element currently shows to `target`.
 * A refresh that arrives mid-animation continues from the current value instead of jumping.
 */
export function countTo(el: HTMLElement, target: number, format: (value: number) => string = defaultFormat, duration = 900) {
  const previous = running.get(el);
  if (previous) cancelAnimationFrame(previous.frame);
  const from = previous?.shown ?? 0;
  if (reduceMotion.matches || from === target) {
    el.textContent = format(target);
    running.set(el, { shown: target, frame: 0 });
    return;
  }
  const state = { shown: from, frame: 0 }, start = performance.now();
  running.set(el, state);
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    state.shown = progress < 1 ? from + (target - from) * (1 - (1 - progress) ** 4) : target;
    el.textContent = format(state.shown);
    if (progress < 1) state.frame = requestAnimationFrame(step);
  };
  state.frame = requestAnimationFrame(step);
}