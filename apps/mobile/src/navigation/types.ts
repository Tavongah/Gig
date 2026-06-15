export type RootStackParamList = {
  MainTabs: undefined;
  GigDetail: { gigId: string };
  GigTracking: { gigId: string };
  GigPayment: { gigId: string };
  PaymentSuccess: { gigId?: string } | undefined;
  PaymentFailed: { gigId?: string } | undefined;
  WorkerStripeConnect: undefined;
  WorkerWorkPreferences: undefined;
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

  NearbyGigs: undefined;

  Earnings: undefined;

  Profile: undefined;

};


