module.exports = {

  presets: [require("nativewind/preset")],

  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],

  theme: {

    extend: {

      colors: {

        night: "#F8FAFC",

        brand: "#6A1B9A",

        orange: "#F7941D",

        success: "#58B947",

        teal: "#3CB6C6",

        magenta: "#C2188B",

        surface: "#F8FAFC",

        ink: "#111827",

        muted: "#475569",
        "nav-muted": "#64748B",

        label: "#334155",

        border: "#E5E7EB",

        danger: "#DC2626",

        warning: "#F7941D",

        card: "#FFFFFF",

        hero: "#F5F0FF",

        disabled: "#E5E7EB",

        "disabled-text": "#9CA3AF",

        verified: "#DCFCE7",

        "verified-text": "#166534"

      },

      fontFamily: {

        sans: ["Inter_400Regular", "Inter_500Medium", "Inter_600SemiBold", "Inter_700Bold", "Inter_800ExtraBold", "system-ui", "sans-serif"]

      },

      borderRadius: {

        "4xl": "2rem",

        "5xl": "2.5rem"

      }

    }

  },

  plugins: []

};

