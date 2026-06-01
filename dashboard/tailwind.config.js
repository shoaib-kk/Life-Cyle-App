import { DRIFT, FOCUS, IDLE, LINK, NUDGE } from "./src/colors.js";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        focus: FOCUS,
        drift: DRIFT,
        idle: IDLE,
        nudge: NUDGE,
        link: LINK
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"]
      },
      fontSize: {
        micro: ["12px", { lineHeight: "18px", fontWeight: "400" }],
        body: ["14px", { lineHeight: "22px", fontWeight: "400" }],
        label: ["11px", { lineHeight: "16px", fontWeight: "500" }],
        value: ["18px", { lineHeight: "26px", fontWeight: "500" }],
        page: ["28px", { lineHeight: "36px", fontWeight: "400" }]
      }
    }
  },
  plugins: []
};
