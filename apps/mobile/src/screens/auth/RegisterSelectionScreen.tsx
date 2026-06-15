import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { APP_NAME } from "../../lib/brand";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "RegisterSelection">;

export function RegisterSelectionScreen({ navigation }: Props) {
  return (
    <Screen>
      <View className="gap-5">
        <Text className="text-2xl font-black text-ink">How will you use {APP_NAME}?</Text>
        <Text className="text-base text-muted">Choose the path that fits you. Workers are reviewed before they can accept gigs.</Text>

        <Pressable onPress={() => navigation.navigate("CustomerRegister")}>
          <DutsCard className="gap-2 p-5">
            <Text className="text-lg font-black text-ink">I need help / Post gigs</Text>
            <Text className="text-sm text-muted">Hire local workers for moving, cleaning, yard work, and more.</Text>
          </DutsCard>
        </Pressable>

        <Pressable onPress={() => navigation.navigate("WorkerRegister")}>
          <DutsCard className="gap-2 p-5">
            <Text className="text-lg font-black text-ink">I want to work / Accept gigs</Text>
            <Text className="text-sm text-muted">Build your profile and get approved to start earning.</Text>
          </DutsCard>
        </Pressable>
      </View>
    </Screen>
  );
}
