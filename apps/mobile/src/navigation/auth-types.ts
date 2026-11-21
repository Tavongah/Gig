export type AuthStackParamList = {
  /** customerOnly is set only for the cart checkout journey, which skips role selection. */
  Login: { customerOnly?: boolean } | undefined;
  RegisterSelection: undefined;
  CustomerRegister: { customerOnly?: boolean } | undefined;
  WorkerRegister: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string } | undefined;
  PrivacyPolicy: undefined;
  TermsOfService: undefined;
};
