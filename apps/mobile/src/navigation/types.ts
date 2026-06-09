export type RootStackParamList = {
  MainTabs: undefined;
  GigDetail: { gigId: string };
  GigTracking: { gigId: string };
  Chat: { gigId: string; title: string };
  Review: { gigId: string; workerName: string };
};



export type ClientTabParamList = {

  Home: undefined;

  PostGig: { serviceCategoryId?: string; preferredWorkerId?: string } | undefined;

  Workers: undefined;

  MyGigs: undefined;

  Profile: undefined;

};



export type WorkerTabParamList = {

  Home: undefined;

  AvailableNow: undefined;

  NearbyGigs: undefined;

  Earnings: undefined;

  Profile: undefined;

};


