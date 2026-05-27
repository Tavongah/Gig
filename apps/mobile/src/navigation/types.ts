export type RootStackParamList = {
  MainTabs: undefined;
  GigDetail: { gigId: string };
  Chat: { gigId: string; title: string };
};

export type ClientTabParamList = {
  Home: undefined;
  Active: undefined;
  History: undefined;
  Profile: undefined;
};

export type WorkerTabParamList = {
  Offers: undefined;
  Active: undefined;
  History: undefined;
  Profile: undefined;
};
