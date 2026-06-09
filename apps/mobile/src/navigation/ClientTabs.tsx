import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { Text, View } from "react-native";

import { ClientHomeScreen } from "../screens/client/ClientHomeScreen";

import { ClientPostScreen } from "../screens/client/ClientPostScreen";

import { AvailableWorkersScreen } from "../screens/client/AvailableWorkersScreen";

import { ClientMyGigsScreen } from "../screens/client/ClientMyGigsScreen";

import { ProfileScreen } from "../screens/shared/ProfileScreen";

import type { ClientTabParamList } from "./types";

import { DUTS } from "../lib/theme";



const Tab = createBottomTabNavigator<ClientTabParamList>();



const TAB_ICONS: Record<keyof ClientTabParamList, string> = {

  Home: "🏠",

  PostGig: "➕",

  Workers: "👷",

  MyGigs: "📋",

  Profile: "👤"

};



const TAB_LABELS: Record<keyof ClientTabParamList, string> = {

  Home: "Home",

  PostGig: "Post",

  Workers: "Workers",

  MyGigs: "Gigs",

  Profile: "Profile"

};



function TabIcon({ routeName, focused }: { routeName: keyof ClientTabParamList; focused: boolean }) {

  return (

    <View className="items-center gap-1">

      <View className={`rounded-2xl px-3 py-1 ${focused ? "bg-brand/10" : ""}`}>

        <Text className="text-lg">{TAB_ICONS[routeName]}</Text>

      </View>

      <Text className={`text-[10px] font-bold ${focused ? "text-brand" : "text-nav-muted"}`}>{TAB_LABELS[routeName]}</Text>

    </View>

  );

}



export function ClientTabs() {

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

        tabBarIcon: ({ focused }) => (

          <TabIcon routeName={route.name as keyof ClientTabParamList} focused={focused} />

        )

      })}

    >

      <Tab.Screen name="Home" component={ClientHomeScreen} />

      <Tab.Screen name="PostGig" component={ClientPostScreen} />

      <Tab.Screen name="Workers" component={AvailableWorkersScreen} />

      <Tab.Screen name="MyGigs" component={ClientMyGigsScreen} />

      <Tab.Screen name="Profile" component={ProfileScreen} />

    </Tab.Navigator>

  );

}

