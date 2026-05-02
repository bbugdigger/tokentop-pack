// Minimal ANSI helpers. No external deps. Color escapes can be disabled by
// setting NO_COLOR=1 (https://no-color.org/) or piping stdout to a non-TTY.

const COLOR = !process.env.NO_COLOR && (process.stdout.isTTY ?? false);

export const ESC = "\x1b[";
export const CLEAR = `${ESC}2J`;
export const HOME = `${ESC}H`;
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
export const RESET = `${ESC}0m`;
export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;
export const REVERSE = `${ESC}7m`;

export function moveTo(row: number, col: number): string {
  return `${ESC}${row};${col}H`;
}

export function clearLine(): string {
  return `${ESC}2K`;
}

function color(code: number, s: string): string {
  if (!COLOR) return s;
  return `${ESC}${code}m${s}${RESET}`;
}

export const fg = {
  black:   (s: string) => color(30, s),
  red:     (s: string) => color(31, s),
  green:   (s: string) => color(32, s),
  yellow:  (s: string) => color(33, s),
  blue:    (s: string) => color(34, s),
  magenta: (s: string) => color(35, s),
  cyan:    (s: string) => color(36, s),
  white:   (s: string) => color(37, s),
  gray:    (s: string) => color(90, s),
};

export function bold(s: string): string {
  return COLOR ? `${BOLD}${s}${RESET}` : s;
}

export function dim(s: string): string {
  return COLOR ? `${DIM}${s}${RESET}` : s;
}

/** Strip ANSI escapes for length calculation. */
export function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").length;
}
