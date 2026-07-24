import { Image, type ImageStyle, type StyleProp } from "react-native";

const logo = require("../../assets/icon.png");

interface BrandLogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function BrandLogo({ size = 72, style }: BrandLogoProps) {
  return (
    <Image
      source={logo}
      accessibilityLabel="DUTS"
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
    />
  );
}
