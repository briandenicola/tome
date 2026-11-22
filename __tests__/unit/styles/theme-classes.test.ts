/**
 * Guards against Tailwind classes that compile to nothing.
 *
 * 1. An opacity modifier on an arbitrary var() color, e.g. `text-[var(--foreground)]/60`. Tailwind 3 can't apply an
 *    opacity to a color it only knows as `var(--x)`, so it emits no CSS at all: muted text renders at full strength,
 *    tints and soft borders don't render. Use the registered theme colors instead (`text-foreground/60`, see
 *    tailwind.config.ts), or `[color:color-mix(in_srgb,var(--x)_60%,transparent)]`.
 * 2. A `var(--x)` in a class whose custom property is defined nowhere, e.g. the old `hover:bg-[var(--accent-color)]`.
 *    The browser drops the declaration, so the style silently does nothing.
 *
 * This lives in the test suite rather than ESLint because the tests are what CI runs on every pull request.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../..");
const SOURCE_DIRS = ["app", "components", "hooks", "lib", "utils"];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

const files = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  path: relative(ROOT, path),
  lines: readFileSync(path, "utf8").split("\n"),
}));

/** Every `--x: …` in app/globals.css, plus custom properties set in source (`[--x:1rem]` classes, `"--x":` styles). */
function definedProperties(): Set<string> {
  const defined = new Set<string>();
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const { lines } of files) {
    for (const line of lines) {
      for (const m of line.matchAll(/\[(--[\w-]+):/g)) defined.add(m[1]);
      for (const m of line.matchAll(/["'](--[\w-]+)["']\s*:/g)) defined.add(m[1]);
    }
  }
  return defined;
}

function findAll(pattern: RegExp, describeMatch: (m: RegExpMatchArray) => string | null): string[] {
  const hits: string[] = [];
  for (const { path, lines } of files) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        const what = describeMatch(m);
        if (what) hits.push(`${path}:${i + 1}  ${what}`);
      }
    });
  }
  return hits;
}

describe("Tailwind theme classes", () => {
  test("no opacity modifier on an arbitrary var() color (Tailwind emits no CSS for it)", () => {
    const hits = findAll(/[\w:-]*\[(?:color:)?var\(--[\w-]+\)\]\/[\d.]+/g, (m) => m[0]);
    expect(hits, `Use a theme color instead, e.g. text-foreground/60 (see tailwind.config.ts):\n${hits.join("\n")}`).toEqual([]);
  });

  test("every var() in a class refers to a custom property that is defined", () => {
    const defined = definedProperties();
    const hits = findAll(/\[[^\]\s"'`]*?var\((--[\w-]+)/g, (m) => (defined.has(m[1]) ? null : m[1]));
    expect(hits, `Not defined in app/globals.css or in source:\n${hits.join("\n")}`).toEqual([]);
  });
});
