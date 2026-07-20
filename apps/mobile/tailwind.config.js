module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#FFFFFF",
        brand: "#7B3FE4",
        orange: "#FF7A18",
        pink: "#FF3D81",
        purple: "#7B3FE4",
        blue: "#3B82F6",
        teal: "#12C6C3",
        success: "#12C6C3",
        magenta: "#FF3D81",
        surface: "#F8FAFC",
        ink: "#111827",
        muted: "#6B7280",
        "nav-muted": "#9CA3AF",
        label: "#374151",
        border: "#E5E7EB",
        danger: "#DC2626",
        warning: "#FF7A18",
        card: "#FFFFFF",
        hero: "#F8FAFC",
        disabled: "#E5E7EB",
        "disabled-text": "#9CA3AF",
        verified: "#ECFDF5",
        "verified-text": "#047857"
      },
      fontFamily: {
        sans: [
          "Inter_400Regular",
          "Inter_500Medium",
          "Inter_600SemiBold",
          "Inter_700Bold",
          "Inter_800ExtraBold",
          "system-ui",
          "sans-serif"
        ]
      },
      borderRadius: {
        "4xl": "1.25rem",
        "5xl": "1.5rem"
      }
    }
  },
  plugins: []
};
