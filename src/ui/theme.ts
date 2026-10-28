import { $ } from "../dom";

const KEY = "dcn.theme";
type Theme = "light" | "dark";

function stored(): Theme | null {
  try { const value = localStorage.getItem(KEY); return value === "light" || value === "dark" ? value : null; } catch { return null; }
}
const preferred = (): Theme => stored() ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  $<HTMLButtonElement>("#theme-toggle").setAttribute("aria-pressed", String(theme === "dark"));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b1721" : "#79BEEE");
}

export function initTheme() {
  apply(preferred());
  $<HTMLButtonElement>("#theme-toggle").addEventListener("click", () => {
    const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  });
}
