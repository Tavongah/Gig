/**
 * Customer auth copy stays shopping-focused on the website, and native strings stay in place.
 * Run: npx tsx scripts/test-customer-auth-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(src, rel), "utf8");

const login = read("screens/auth/LoginScreen.tsx");
const register = read("screens/auth/CustomerRegisterScreen.tsx");
const forgot = read("screens/auth/ForgotPasswordScreen.tsx");
const reset = read("screens/auth/ResetPasswordScreen.tsx");
const choice = read("screens/auth/RegisterSelectionScreen.tsx");

assert.ok(login.includes("api.login"), "login still uses the login API");
assert.ok(login.includes("loginSchema"), "login validation unchanged");
assert.ok(login.includes("Sign in to book help or start earning"), "native login copy remains");
assert.ok(login.includes("Sign in to shop, place orders and track your deliveries."), "website login copy");
assert.ok(login.includes('Platform.OS !== "web"'), "website login is a separate return");
assert.ok(login.includes("SocialAuthButtons"), "Google and Apple entry remains");
assert.ok(login.includes('navigate("ForgotPassword")'), "forgot password navigation remains");
assert.ok(login.includes('navigate("RegisterSelection")'), "create account navigation remains");

assert.ok(register.includes("api.registerCustomer"), "registration API unchanged");
assert.ok(register.includes("customerRegisterSchema"), "registration validation unchanged");
assert.ok(register.includes("Create your account"), "native registration heading remains");
assert.ok(register.includes("Join DUTS"), "website registration heading");
assert.ok(register.includes("Create an account to shop, save your details and track your orders."), "website registration copy");

assert.ok(forgot.includes("api.forgotPassword"), "password recovery API unchanged");
assert.ok(forgot.includes("Forgot password"), "native recovery heading remains");
assert.ok(forgot.includes("Reset your password"), "website recovery heading");
assert.ok(forgot.includes("Enter your email and we'll help you get back to shopping."), "website recovery copy");

assert.ok(reset.includes("api.resetPassword"), "reset API unchanged");
assert.ok(reset.includes("Choose a new password"), "reset heading remains");
assert.ok(reset.includes("This reset link is missing or invalid."), "invalid reset state remains");

assert.ok(choice.includes("Find local gigs and earn money."), "native worker option remains");
assert.ok(choice.includes("Book trusted local workers for your tasks."), "native customer option remains");
assert.ok(choice.includes('navigate(intendedRole === "WORKER" ? "WorkerRegister" : "CustomerRegister")'), "role routing unchanged");
assert.ok(choice.includes("Shop on DUTS"), "website shopper option");
assert.ok(choice.includes("Work with DUTS"), "website worker option remains available");
const webChoice = choice.slice(choice.indexOf("const webOptions"));
assert.ok(webChoice.includes("backgroundColor: DUTS.purple"), "shop option is the primary purple action");
assert.ok(webChoice.indexOf("Shop on DUTS") < webChoice.indexOf("Work with DUTS"), "shop option is listed first");
assert.ok(webChoice.includes('option.role === "CLIENT"'), "primary treatment is the shopper choice");
assert.ok(!choice.includes("Gigflow"), "no Gigflow customer copy");

console.log(JSON.stringify({ ok: true }));
