import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        graphite: "#1E1B16",
        graphite2: "#2A2620",
        ivory: "#FBF7EE",
        ivorydim: "#EDE6D6",
        copper: "#E8A33D",
        copperdim: "#B97F2C",
        ink: "#3A352C",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      keyframes: {
        scanline: {
          "0%": { top: "0%" },
          "100%": { top: "100%" },
        },
        flipin: {
          "0%": { transform: "rotateY(90deg)", opacity: "0" },
          "100%": { transform: "rotateY(0deg)", opacity: "1" },
        },
      },
      animation: {
        scanline: "scanline 1.6s linear infinite",
        flipin: "flipin 0.6s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
