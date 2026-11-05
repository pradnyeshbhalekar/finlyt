/** @type {import('tailwindcss').Config} */

// Theme-aware colours come from CSS variables set on the root view (src/lib/theme.ts), so the
// same class works in the Light, Dark and Ink themes.
const themed = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: themed("bg"),
        surface: themed("surface"),
        line: themed("line"),
        fg: themed("fg"),
        muted: themed("muted"),
        faint: themed("faint"),
        accent: themed("accent"),
        "accent-soft": themed("accent-soft"),
        danger: themed("danger"),
        "warn-bg": themed("warn-bg"),
        "warn-fg": themed("warn-fg"),
        // Fixed brand colours from the "Finlyt logo" canvas.
        brand: "#3355FF",
        ink: "#0B1033",
        tint: "#AEBBFF",
      },
    },
  },
  plugins: [],
};
