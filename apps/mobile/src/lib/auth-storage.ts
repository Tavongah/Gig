import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "duts_auth_token";

export const authStorage = {
  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(TOKEN_KEY);
  },
  async setToken(token: string): Promise<void> {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },
  async clearToken(): Promise<void> {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
};
