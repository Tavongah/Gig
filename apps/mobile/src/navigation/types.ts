export type RootStackParamList = {
  MainTabs: undefined;
  PostGig: { serviceCategoryId?: string; preferredWorkerId?: string } | undefined;
  DeliveryRequest: undefined;
  DeliveryPins: {
    gigId: string;
    pickupPin: string;
    deliveryPin: string;
    replay?: boolean;
  };
  DeliveryJob: { gigId: string };
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
  WorkerDeliverySetup: undefined;
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
  ProductSearch: { q?: string; category?: string } | undefined;
  ProductDetail: { catalogProductId?: string; productId?: string };
  ShopDetail: { merchantId: string };
  CommerceCheckout: undefined;
  CommerceOrderDetail: { orderId: string };
};

export type ClientTabParamList = {
  Home: undefined;
  Search: undefined;
  Orders: undefined;
  Cart: undefined;
  Account: undefined;
};

export type WorkerTabParamList = {
  Home: undefined;
  NearbyGigs: undefined;
  Support: undefined;
  Earnings: undefined;
  Profile: undefined;
};
