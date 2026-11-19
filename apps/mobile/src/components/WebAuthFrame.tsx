import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { webCustomerTabBarHeight } from "../navigation/CustomerNavBar";
import { useStorefrontLayout } from "../lib/storefront-ui";

export function WebAuthFrame({ children }: { children: ReactNode }) {
  const { isDesktopNav } = useStorefrontLayout();
  const insets = useSafeAreaInsets();
  const bottom = isDesktopNav ? 32 : webCustomerTabBarHeight(insets.bottom, false) + 16;

  return (
    <View className="w-full self-center" style={{ maxWidth: 440, paddingBottom: bottom, paddingTop: isDesktopNav ? 12 : 0 }}>
      {children}
    </View>
  );
}
