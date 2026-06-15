import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { DUTS } from "../lib/theme";
import { APP_NAME } from "../lib/brand";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { RegisterSelectionScreen } from "../screens/auth/RegisterSelectionScreen";
import { CustomerRegisterScreen } from "../screens/auth/CustomerRegisterScreen";
import { WorkerRegisterScreen } from "../screens/auth/WorkerRegisterScreen";
import { ForgotPasswordScreen } from "../screens/auth/ForgotPasswordScreen";
import type { AuthStackParamList } from "./auth-types";

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: DUTS.background },
        headerStyle: { backgroundColor: DUTS.card },
        headerTintColor: DUTS.ink,
        headerTitleStyle: { fontWeight: "800", color: DUTS.ink },
        headerShadowVisible: false
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="RegisterSelection" component={RegisterSelectionScreen} options={{ title: `Join ${APP_NAME}` }} />
      <Stack.Screen name="CustomerRegister" component={CustomerRegisterScreen} options={{ title: "Customer sign up" }} />
      <Stack.Screen name="WorkerRegister" component={WorkerRegisterScreen} options={{ title: "Worker sign up" }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Reset password" }} />
    </Stack.Navigator>
  );
}
