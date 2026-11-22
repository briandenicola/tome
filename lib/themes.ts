/**
 * Tome's themes: its own Light and Dark, plus the Aurearia museum palettes shared with the Aurearia, Domus and Watch
 * Tracker apps. The colours themselves live in app/globals.css; this is the list the picker and the theme script use.
 *
 * Each theme sets two attributes on <html>:
 * - data-theme: "light" or "dark", the mode. Everything that only cares whether the page is dark reads this (the
 *   `dark:` variant, the notes editor, toasts, scrollbars, the streak heatmap).
 * - data-palette: the museum theme's id, which overrides the colour tokens. Absent for Tome's own Light and Dark.
 */

export type ThemeMode = "light" | "dark";

export interface ThemeInfo {
  label: string;
  mode: ThemeMode;
  /** Background, surface and accent, for the swatch in the picker. */
  swatch: readonly [string, string, string];
}

// Order here is the order in the picker.
export const THEMES = {
  light: { label: "Light", mode: "light", swatch: ["#f0eae3", "#f5f1e8", "#8b6f47"] },
  dark: { label: "Dark", mode: "dark", swatch: ["#1f1c19", "#3d3935", "#a89968"] },
  aurea: { label: "Aurea", mode: "dark", swatch: ["#0f0f1a", "#16213e", "#c9a84c"] },
  parchment: { label: "Parchment", mode: "light", swatch: ["#f5f0e8", "#ffffff", "#9a7b2e"] },
  "british-museum": { label: "British Museum", mode: "dark", swatch: ["#0c0c0b", "#1a1a19", "#d8d4cc"] },
  louvre: { label: "Louvre", mode: "dark", swatch: ["#1a1510", "#2a2218", "#977b3c"] },
  capitoline: { label: "Capitoline", mode: "dark", swatch: ["#0a0808", "#8e1f2f", "#f0bc42"] },
  byzantine: { label: "Byzantine", mode: "dark", swatch: ["#100a08", "#ba0e09", "#ffbf00"] },
  "modern-greek": { label: "Modern Greek", mode: "dark", swatch: ["#060d18", "#0d5eaf", "#ffffff"] },
} as const satisfies Record<string, ThemeInfo>;

export type ThemeId = keyof typeof THEMES;
/** What the person picked: a theme, or "auto" to follow the device between Light and Dark. */
export type ThemePreference = ThemeId | "auto";

export const THEME_GROUPS: { label: string; themes: ThemePreference[] }[] = [
  { label: "Standard", themes: ["auto", "light", "dark"] },
  { label: "Museum", themes: ["aurea", "parchment", "british-museum", "louvre", "capitoline", "byzantine", "modern-greek"] },
];

export const THEME_STORAGE_KEY = "themePreference";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || (typeof value === "string" && Object.prototype.hasOwnProperty.call(THEMES, value));
}

/** The theme actually shown: "auto" follows the device. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeId {
  if (preference === "auto") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function themeLabel(preference: ThemePreference): string {
  return preference === "auto" ? "Match device" : THEMES[preference].label;
}

/** "Match device" shows half Light, half Dark, like the device it follows. */
export function themeSwatch(preference: ThemePreference): readonly string[] {
  if (preference === "auto") return [THEMES.light.swatch[0], THEMES.dark.swatch[0]];
  return THEMES[preference].swatch;
}

/** Sets data-theme (mode), data-color-mode (read by the markdown editor) and data-palette on <html>. */
export function applyTheme(root: HTMLElement, id: ThemeId): void {
  const { mode } = THEMES[id];
  root.setAttribute("data-theme", mode);
  root.setAttribute("data-color-mode", mode);
  if (id === "light" || id === "dark") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", id);
}

/**
 * The same as resolveTheme + applyTheme, as a self-contained script for <head>, so the first paint is already in the
 * right theme. It also migrates the old `darkMode` boolean setting.
 */
export function themeBootScript(): string {
  const modes = Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.mode]));
  return `(function () {
  try {
    var modes = ${JSON.stringify(modes)};
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var pref = localStorage.getItem(key);
    var old = localStorage.getItem("darkMode");
    if (pref !== "auto" && !modes.hasOwnProperty(pref)) {
      pref = "auto";
      if (old !== null) {
        pref = old === "true" ? "dark" : "light";
        localStorage.setItem(key, pref);
        localStorage.removeItem("darkMode");
      }
    }
    var id = pref === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
    var root = document.documentElement;
    root.setAttribute("data-theme", modes[id]);
    root.setAttribute("data-color-mode", modes[id]);
    if (id === "light" || id === "dark") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", id);
  } catch (e) {}
})();`;
}
