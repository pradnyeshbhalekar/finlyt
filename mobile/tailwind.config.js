/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Finlyt brand. Tints/shades are #3355FF mixed with white/black.
        primary: {
          DEFAULT: "#3355FF",
          50: "#F5F7FF",
          100: "#EBEEFF",
          200: "#CCD5FF",
          300: "#A3B3FF",
          400: "#7088FF",
          500: "#3355FF",
          600: "#2B48D9",
          700: "#243CB3",
          800: "#1C2F8C",
          900: "#142266",
          950: "#0D1540",
        },
        // From the "Finlyt logo" canvas: Ink is the brand's near-black, Tint its light blue.
        secondary: {
          DEFAULT: "#0B1033",
        },
        ink: "#0B1033",
        tint: "#AEBBFF",
      },
    },
  },
  plugins: [],
};
