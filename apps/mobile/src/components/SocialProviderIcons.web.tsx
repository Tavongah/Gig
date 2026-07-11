import { createElement } from "react";
import { View } from "react-native";

interface IconProps {
  size?: number;
}

export function GoogleIcon({ size = 20 }: IconProps) {
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Google">
      {createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 48 48",
          xmlns: "http://www.w3.org/2000/svg",
          "aria-hidden": true
        },
        createElement("path", {
          fill: "#FFC107",
          d: "M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 28.991 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
        }),
        createElement("path", {
          fill: "#FF3D00",
          d: "m6.306 14.691 6.571 4.819C14.655 16.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 28.991 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
        }),
        createElement("path", {
          fill: "#4CAF50",
          d: "M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
        }),
        createElement("path", {
          fill: "#1976D2",
          d: "M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
        })
      )}
    </View>
  );
}

export function AppleIcon({ size = 20 }: IconProps) {
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Apple">
      {createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          xmlns: "http://www.w3.org/2000/svg",
          "aria-hidden": true
        },
        createElement("path", {
          fill: "#111827",
          d: "M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
        })
      )}
    </View>
  );
}
