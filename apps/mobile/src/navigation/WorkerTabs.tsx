import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { Text, View } from "react-native";

import { WorkerHomeScreen } from "../screens/worker/WorkerHomeScreen";

import { WorkerAvailableNowScreen } from "../screens/worker/WorkerAvailableNowScreen";

import { WorkerNearbyGigsScreen } from "../screens/worker/WorkerNearbyGigsScreen";

import { WorkerEarningsScreen } from "../screens/worker/WorkerEarningsScreen";

import { ProfileScreen } from "../screens/shared/ProfileScreen";

import type { WorkerTabParamList } from "./types";

import { DUTS } from "../lib/theme";



const Tab = createBottomTabNavigator<WorkerTabParamList>();



const TAB_ICONS: Record<string, string> = {

  Home: "🏠",

  AvailableNow: "⚡",

  NearbyGigs: "📍",

  Earnings: "💰",

  Profile: "👤"

};



const TAB_LABELS: Record<string, string> = {

  Home: "Home",

  AvailableNow: "Available",

  NearbyGigs: "Nearby",

  Earnings: "Earnings",

  Profile: "Profile"

};



function TabIcon({ label, focused }: { label: string; focused: boolean }) {

  return (

    <View className="items-center gap-1">

      <View className={`rounded-2xl px-3 py-1 ${focused ? "bg-brand/10" : ""}`}>

        <Text className="text-lg">{TAB_ICONS[label] ?? "•"}</Text>

      </View>

      <Text className={`text-[10px] font-bold ${focused ? "text-brand" : "text-nav-muted"}`}>

        {TAB_LABELS[label] ?? label}

      </Text>

    </View>

  );

}



export function WorkerTabs() {

  return (

    <Tab.Navigator

      screenOptions={({ route }) => ({

        headerShown: false,

        tabBarStyle: {

          backgroundColor: DUTS.card,

          borderTopColor: DUTS.border,

          height: 76,

          paddingBottom: 10,

          paddingTop: 8

        },

        tabBarShowLabel: false,

        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />

      })}

    >

      <Tab.Screen name="Home" component={WorkerHomeScreen} />

      <Tab.Screen name="AvailableNow" component={WorkerAvailableNowScreen} />

      <Tab.Screen name="NearbyGigs" component={WorkerNearbyGigsScreen} />

      <Tab.Screen name="Earnings" component={WorkerEarningsScreen} />

      <Tab.Screen name="Profile" component={ProfileScreen} />

    </Tab.Navigator>

  );

}

