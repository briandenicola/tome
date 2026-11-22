"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  resolveTheme,
  type ThemeId,
  type ThemeMode,
  type ThemePreference,
} from "@/lib/themes";

export type { ThemePreference, ThemeId };
/** Light or dark: the mode of the theme being shown. */
export type Theme = ThemeMode;

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("auto");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The theme being shown, and whether it is light or dark
  const themeId: ThemeId = resolveTheme(preference, systemPrefersDark);
  const effectiveTheme: Theme = THEMES[themeId].mode;

  // Initialize from localStorage with migration
  useEffect(() => {
    setMounted(true);
    
    const savedPreference = localStorage.getItem(THEME_STORAGE_KEY);
    const oldSavedMode = localStorage.getItem("darkMode");
    
    if (isThemePreference(savedPreference)) {
      setPreference(savedPreference);
    } else if (oldSavedMode !== null) {
      // Migrate from old boolean format
      const migratedPreference: ThemePreference = oldSavedMode === "true" ? "dark" : "light";
      setPreference(migratedPreference);
      localStorage.setItem(THEME_STORAGE_KEY, migratedPreference);
      localStorage.removeItem("darkMode");
    }
    // else: keep default "auto"
  }, []);

  // System preference listener
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Apply theme to DOM whenever effective theme changes
  useEffect(() => {
    if (!mounted) return;
    
    applyTheme(document.documentElement, themeId);
  }, [themeId, mounted]);

  // Cross-tab sync via storage events
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only handle themePreference changes from other tabs
      if (e.key === THEME_STORAGE_KEY) {
        if (isThemePreference(e.newValue)) {
          // Valid new preference - update state
          setPreference(e.newValue);
        } else if (e.newValue === null) {
          // Key was deleted - revert to default
          setPreference("auto");
        } else if (e.newValue) {
          // Invalid value - keep current theme and notify user
          toast.error(
            "Theme preference was corrupted. Keeping your current theme.",
            { duration: 5000 }
          );
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Update preference
  const setThemePreference = useCallback((newPreference: ThemePreference) => {
    setPreference(newPreference);
    localStorage.setItem(THEME_STORAGE_KEY, newPreference);
  }, []);

  return { 
    preference, 
    effectiveTheme,
    themeId,
    setThemePreference,
    mounted 
  };
}
