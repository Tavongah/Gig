export type RootStackParamList = {
  MainTabs: undefined;
  PostGig: { serviceCategoryId?: string; preferredWorkerId?: string } | undefined;
  GigDetail: { gigId: string };
  WorkerMatching: { gigId: string };
  GigTracking: { gigId: string };
  GigSelectWorkers: { gigId: string };
  GigWorkerSummary: { gigId: string; workerId: string };
  GigPayment: { gigId: string; workerId?: string };
  GigCompletionReview: { gigId: string };
  PaymentSuccess: { gigId?: string } | undefined;
  PaymentFailed: { gigId?: string } | undefined;
  WorkerStripeConnect: undefined;
  WorkerWorkPreferences: undefined;
  EditProfile: undefined;
  Addresses: undefined;
  PaymentMethods: undefined;
  Notifications: undefined;
  Security: undefined;
  ChangePassword: undefined;
  IdentityVerification: undefined;
  MyGigsActivity: undefined;
  PaymentHistory: undefined;
  Receipts: undefined;
  RatingsReviews: undefined;
  Safety: undefined;
  Faq: undefined;
  AboutDuts: undefined;
  PrivacyPolicy: undefined;
  TermsOfService: undefined;
  Chat: { gigId: string; title: string };
  Review: { gigId: string; workerName: string };
};

export type ClientTabParamList = {
  Home: undefined;
  Support: undefined;
  MyGigs: undefined;
  Profile: undefined;
};

export type WorkerTabParamList = {
  Home: undefined;
  NearbyGigs: undefined;
  Support: undefined;
  Earnings: undefined;
  Profile: undefined;
};
