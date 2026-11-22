"use client";

import { Palette } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { THEME_GROUPS, themeLabel, themeSwatch, THEMES } from "@/lib/themes";
import { cn } from "@/utils/cn";

/** Theme picker, laid out like the Appearance section of the Aurearia, Domus and Watch Tracker apps. */
export function ThemeSettings() {
  const { preference, themeId, setThemePreference } = useTheme();

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <Palette className="w-6 h-6 text-[var(--accent)]" />
        <h3 className="text-xl font-serif font-bold text-[var(--heading-text)]">Theme</h3>
      </div>

      <p className="text-sm text-[var(--subheading-text)] mb-4 font-medium">Choose how Tome looks on this device</p>

      {THEME_GROUPS.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p id={`theme-group-${group.label}`} className="text-xs uppercase tracking-wide text-foreground/60 mb-2">
            {group.label}
          </p>
          <div role="radiogroup" aria-labelledby={`theme-group-${group.label}`} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {group.themes.map((id) => {
              const selected = preference === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setThemePreference(id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-3 border rounded-md text-sm font-medium text-left transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    selected
                      ? "border-[var(--accent)] bg-accent/10 text-[var(--accent)]"
                      : "border-[var(--border-color)] bg-[var(--background)] text-[var(--subheading-text)] hover:border-accent/50"
                  )}
                >
                  <span className="flex shrink-0 w-6 h-4 rounded-full overflow-hidden border border-[var(--border-color)]" aria-hidden="true">
                    {themeSwatch(id).map((color, i) => (
                      <span key={i} className="flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="truncate">{themeLabel(id)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {preference === "auto" && (
        <p className="text-xs text-[var(--accent)] mt-3 font-medium">Currently showing: {THEMES[themeId].label}</p>
      )}
    </div>
  );
}
