/**
 * Manual auth integration checks against a running API (default http://localhost:4000).
 * Run: npx tsx scripts/test-auth-flow.ts
 */
const API = process.env.API_URL ?? "http://127.0.0.1:4000/v1";

type Json = Record<string, unknown>;

async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, body };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const stamp = Date.now();
  const customerEmail = `auth-test-${stamp}@example.com`;
  const customerPhone = `+1555${String(stamp).slice(-7)}`;
  const password = "TestPass123!";

  const categoriesRes = await request("/gigs/categories");
  assert(categoriesRes.status === 200, "categories lookup failed");
  const categoryId = (categoriesRes.body.categories as Array<{ id: string }>)[0]?.id;
  assert(Boolean(categoryId), "seed categories required for auth tests");

  console.log("1. Customer email/password signup");
  const register = await request("/auth/register/customer", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Auth Test Customer",
      email: customerEmail,
      phoneNumber: customerPhone,
      password,
      confirmPassword: password
    })
  });
  assert(register.status === 201, `register failed: ${register.status} ${JSON.stringify(register.body)}`);
  const token = register.body.token as string;
  const user = register.body.user as Json;
  assert(user.emailVerified === false, "new customer should require email verification");

  console.log("2. Duplicate email prevention");
  const dupEmail = await request("/auth/register/customer", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Dup",
      email: customerEmail,
      phoneNumber: `+1555${String(stamp + 1).slice(-7)}`,
      password,
      confirmPassword: password
    })
  });
  assert(dupEmail.status === 409, "duplicate email should be rejected");

  console.log("3. Login with existing account");
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: customerEmail, password })
  });
  assert(login.status === 200, "login should succeed for unverified user");

  console.log("4. Resend verification email");
  const resend = await request("/auth/verify-email/resend", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  assert(resend.status === 200, "resend verification should succeed");

  console.log("5. Phone OTP request + verify");
  const otpReq = await request("/auth/verify-phone/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phoneNumber: customerPhone })
  });
  assert(otpReq.status === 200, `otp request failed: ${JSON.stringify(otpReq.body)}`);
  const devCode = otpReq.body.devCode as string | undefined;
  assert(Boolean(devCode), "dev OTP code should be returned in development");

  const otpConfirm = await request("/auth/verify-phone/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phoneNumber: customerPhone, code: devCode })
  });
  assert(otpConfirm.status === 200, `otp confirm failed: ${JSON.stringify(otpConfirm.body)}`);
  const verifiedUser = otpConfirm.body.user as Json;
  assert(verifiedUser.phoneVerified === true, "phone should be verified");

  console.log("6. Duplicate phone prevention");
  const otherEmail = `auth-test-other-${stamp}@example.com`;
  const otherRegister = await request("/auth/register/customer", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Other User",
      email: otherEmail,
      phoneNumber: customerPhone,
      password,
      confirmPassword: password
    })
  });
  assert(otherRegister.status === 409, "duplicate phone at signup should be rejected");

  console.log("7. Customer blocked from posting gigs before email verification");
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const createGig = await request("/gigs", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      serviceCategoryId: categoryId,
      title: "Auth gate test gig",
      description: "Need help moving a couch across town for testing verification gates.",
      estimatedHours: 2,
      urgency: "STANDARD",
      startsAt,
      location: {
        formattedAddress: "123 Main St, Atlanta, GA 30303",
        addressLine1: "123 Main St",
        city: "Atlanta",
        region: "GA",
        postalCode: "30303",
        country: "US",
        latitude: 33.749,
        longitude: -84.388
      }
    })
  });
  assert(createGig.status === 403, `unverified email customer should not post gigs (${createGig.status})`);

  console.log("8. Worker blocked from going online before verification + approval");
  const workerEmail = `auth-worker-${stamp}@example.com`;
  const workerPhone = `+1666${String(stamp).slice(-7)}`;
  const workerRegister = await request("/auth/register/worker", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Auth Test Worker",
      email: workerEmail,
      phoneNumber: workerPhone,
      password,
      confirmPassword: password,
      bio: "Experienced helper available for local gigs around town every weekend.",
      serviceCategoryIds: [categoryId],
      city: "Atlanta",
      serviceArea: "Metro Atlanta",
      travelDistanceMiles: 15,
      workExperience: "Two years helping neighbors move furniture and run errands.",
      governmentIdAcknowledged: true,
      proofOfAddressAcknowledged: true,
      platformRulesAgreed: true,
      backgroundCheckConsent: true
    })
  });
  assert(workerRegister.status === 201, `worker register failed: ${JSON.stringify(workerRegister.body)}`);
  const workerToken = workerRegister.body.token as string;

  const goOnline = await request("/workers/availability", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({
      serviceCategoryIds: [categoryId],
      latitude: 33.749,
      longitude: -84.388,
      travelDistanceMiles: 10,
      hourlyRateCents: 3500,
      minJobAmountCents: 5000
    })
  });
  assert(goOnline.status === 403, "unverified/unapproved worker should not go online");

  console.log("\nAll auth flow checks passed.");
}

main().catch((error) => {
  console.error("\nAuth flow test failed:", error);
  process.exit(1);
});
