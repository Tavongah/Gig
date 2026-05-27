module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101828",
        brand: "#21C07A",
        night: "#07111F"
      }
    }
  },
  plugins: []
};
