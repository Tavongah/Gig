import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../../lib/use-reduced-motion";

type Props = PressableProps & {
  scale?: number;
  style?: StyleProp<ViewStyle>;
};

export function PressScale({ scale = 0.97, style, children, ...rest }: Props) {
  const reduce = useReducedMotion();
  return (
    <Pressable
      {...rest}
      style={(state) => {
        const extra = typeof style === "function" ? undefined : style;
        return [
          extra,
          { transform: [{ scale: !reduce && state.pressed ? scale : 1 }] }
        ];
      }}
    >
      {children}
    </Pressable>
  );
}
