import { describe, test, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEMES,
  THEME_GROUPS,
  applyTheme,
  isThemePreference,
  resolveTheme,
  themeBootScript,
  themeSwatch,
} from "@/lib/themes";

describe("themes", () => {
  test("every museum theme shared with Aurearia, Domus and Watch Tracker is offered", () => {
    const offered = THEME_GROUPS.flatMap((g) => g.themes);
    for (const id of ["aurea", "parchment", "british-museum", "louvre", "capitoline", "byzantine", "modern-greek"]) {
      expect(offered).toContain(id);
    }
    expect(offered).toContain("auto");
    expect(new Set(offered).size).toBe(offered.length);
  });

  test("every museum theme has its colours in globals.css", () => {
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    for (const id of Object.keys(THEMES)) {
      if (id === "light" || id === "dark") continue;
      expect(css, id).toContain(`html[data-palette="${id}"]`);
    }
  });

  test("accepts known themes and auto, and nothing else", () => {
    expect(isThemePreference("auto")).toBe(true);
    expect(isThemePreference("byzantine")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference("toString")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  test("auto follows the device between Light and Dark", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("parchment", true)).toBe("parchment");
  });

  test("match device swatch is half Light, half Dark", () => {
    expect(themeSwatch("auto")).toEqual([THEMES.light.swatch[0], THEMES.dark.swatch[0]]);
  });

  describe("on <html>", () => {
    const root = document.documentElement;
    beforeEach(() => {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-color-mode");
      root.removeAttribute("data-palette");
      localStorage.clear();
    });

    test("a museum theme sets its mode and palette", () => {
      applyTheme(root, "capitoline");
      expect(root.dataset.theme).toBe("dark");
      expect(root.dataset.colorMode).toBe("dark");
      expect(root.dataset.palette).toBe("capitoline");

      applyTheme(root, "parchment");
      expect(root.dataset.theme).toBe("light");
      expect(root.dataset.palette).toBe("parchment");
    });

    test("Tome's own Light and Dark clear the palette", () => {
      applyTheme(root, "aurea");
      applyTheme(root, "dark");
      expect(root.dataset.theme).toBe("dark");
      expect(root.hasAttribute("data-palette")).toBe(false);
    });

    const boot = () => new Function(themeBootScript())();

    test("the boot script applies a saved museum theme before React starts", () => {
      localStorage.setItem("themePreference", "modern-greek");
      boot();
      expect(root.dataset.theme).toBe("dark");
      expect(root.dataset.palette).toBe("modern-greek");
    });

    test("the boot script ignores an unknown theme and migrates the old darkMode setting", () => {
      localStorage.setItem("themePreference", "no-such-theme");
      localStorage.setItem("darkMode", "true");
      boot();
      expect(root.dataset.theme).toBe("dark");
      expect(localStorage.getItem("themePreference")).toBe("dark");
      expect(localStorage.getItem("darkMode")).toBeNull();
    });
  });
});
