// Brand colours for places that need raw values (navigation theme, icons, spinners, SVG, native config).
// Tailwind classes use the same palette via `primary`, `secondary`, `ink` and `tint` in tailwind.config.js.
// Source of truth: the "Finlyt logo" design canvas (Brand, Tint, Ink, White).
export const colors = {
  primary: "#3355FF", // Brand
  primaryPressed: "#243CB3", // primary-700
  primaryOnDark: "#7088FF", // primary-400: readable on black
  primaryEdge: "#2440E6", // the coin's rim when drawn in brand blue
  tint: "#AEBBFF",
  ink: "#0B1033", // text and secondary buttons in light mode
  secondary: "#0B1033",
  black: "#000000", // dark-mode backgrounds
  white: "#FFFFFF",
  border: "#E4E4E7", // zinc-200
  borderDark: "#27272A", // zinc-800
  muted: "#A1A1AA", // zinc-400
} as const;
