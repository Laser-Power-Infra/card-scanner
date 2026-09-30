import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm paper page background; neutrals use Tailwind's built-in warm `stone`.
        paper: "#F7F5F0",
        ink: "#1C1B18",
        // Single accent: deep ink-green.
        accent: {
          50: "#F0F5F2",
          100: "#E4EDE8",
          200: "#C6D9CF",
          300: "#9DBDAD",
          400: "#6B9985",
          500: "#437A65",
          600: "#2C6150",
          700: "#1F4D3F",
          800: "#183D32",
          900: "#122E26",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-geist)", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      boxShadow: {
        // Warm-tinted, single light source from above.
        soft: "0 1px 2px rgba(28,27,24,0.04), 0 2px 8px -2px rgba(28,27,24,0.06)",
        lift: "0 2px 4px rgba(28,27,24,0.04), 0 12px 28px -8px rgba(28,27,24,0.14)",
        pop: "0 4px 8px rgba(28,27,24,0.06), 0 24px 56px -12px rgba(28,27,24,0.24)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(0)" },
          // Animated element is full-height, so 100% = container height.
          "100%": { transform: "translateY(100%)" },
        },
        rise: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        scanline: "scanline 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate",
        // backwards, not both: a persisting transform would trap position:fixed descendants.
        rise: "rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
      },
    },
  },
  plugins: [],
};

export default config;
