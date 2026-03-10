import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0f4ff",
          300: "#93a8fb",
          400: "#6d84f9",
          500: "#4f6ef7",
          600: "#3b55e0",
          900: "#1a2460",
        },
      },
    },
  },
  plugins: [],
};

export default config;
