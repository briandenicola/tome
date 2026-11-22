import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/** A theme color backed by a CSS variable that still supports Tailwind's `/<opacity>` modifier. */
const themeColor = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  // `dark:` follows Tome's theme (data-theme on <html>, see lib/themes.ts), not the device's setting.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./utils/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Theme colors live in CSS custom properties (app/globals.css) as hex values, which
      // Tailwind can't apply an opacity modifier to (`text-[var(--foreground)]/60` emits no CSS).
      // Registering them through color-mix makes `text-foreground/60`, `bg-accent/20` etc. work.
      colors: {
        background: themeColor("--background"),
        foreground: themeColor("--foreground"),
        heading: themeColor("--heading-text"),
        subheading: themeColor("--subheading-text"),
        accent: themeColor("--accent"),
        "light-accent": themeColor("--light-accent"),
        "dark-accent": themeColor("--dark-accent"),
        card: themeColor("--card-bg"),
        "card-emphasis": themeColor("--card-bg-emphasis"),
        border: themeColor("--border-color"),
        "accent-ink": themeColor("--accent-ink"),
      },
      fontFamily: {
        // Headings and titles: the theme's display face (plain serif, or Cinzel in the museum themes).
        serif: ["var(--font-display)"],
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "Monaco", "Courier New", "monospace"],
      },
    },
  },
  plugins: [typography],
};
export default config;
