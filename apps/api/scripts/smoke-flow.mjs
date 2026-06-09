const base = "http://127.0.0.1:4000/v1";
const suffix = Date.now();

async function req(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path}: ${JSON.stringify(json)}`);
  }

  return json;
}

const categories = await req("/gigs/categories");
const categoryId = categories.mvp[0].id;

const client = await req("/auth/register/customer", {
  method: "POST",
  body: {
    fullName: "Flow Client",
    email: `client-flow-${suffix}@test.local`,
    phoneNumber: "+14045550101",
    password: "TestPass123!",
    confirmPassword: "TestPass123!"
  }
});

const gig = await req("/gigs", {
  method: "POST",
  token: client.token,
  body: {
    title: "Move boxes upstairs",
    description: "Need help moving boxes to the second floor today.",
    serviceCategoryId: categoryId,
    estimatedHours: 2,
    distanceMiles: 0,
    urgency: "STANDARD",
    startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    demandMultiplier: 1,
    size: "MEDIUM",
    photos: [],
    location: {
      latitude: 33.749,
      longitude: -84.388,
      addressLine1: "100 Peachtree St",
      city: "Atlanta",
      region: "GA",
      postalCode: "30303",
      country: "US"
    }
  }
});

console.log("posted:", gig.gig.status);

const workerPending = await req("/auth/register/worker", {
  method: "POST",
  body: {
    fullName: "Flow Worker",
    email: `worker-flow-${suffix}@test.local`,
    phoneNumber: "+14045550102",
    password: "TestPass123!",
    confirmPassword: "TestPass123!",
    bio: "Experienced mover with five years of local experience in Atlanta.",
    serviceCategoryIds: [categoryId],
    city: "Atlanta",
    serviceArea: "Metro Atlanta",
    travelDistanceMiles: 15,
    workExperience: "Five years of moving and hauling experience.",
    hourlyRateCents: 3500,
    minJobAmountCents: 5000,
    hasVehicle: true,
    governmentIdAcknowledged: true,
    proofOfAddressAcknowledged: true,
    platformRulesAgreed: true,
    backgroundCheckConsent: true
  }
});

console.log("worker_status:", workerPending.user.accountStatus);

let acceptBlocked = false;
try {
  await req(`/gigs/${gig.gig.id}/accept`, { method: "POST", token: workerPending.token });
} catch {
  acceptBlocked = true;
}
console.log("pending_worker_blocked:", acceptBlocked);

const admin = await req("/auth/login", {
  method: "POST",
  body: { email: "admin@gigflow.local", password: "Admin123!" }
});

await req(`/admin/workers/${workerPending.user.id}/approve`, { method: "POST", token: admin.token });

const worker = await req("/auth/login", {
  method: "POST",
  body: { email: `worker-flow-${suffix}@test.local`, password: "TestPass123!" }
});

await req("/workers/availability", {
  method: "PATCH",
  token: worker.token,
  body: {
    latitude: 33.749,
    longitude: -84.388,
    travelDistanceMiles: 15,
    hourlyRateCents: 3500,
    minJobAmountCents: 5000,
    serviceCategoryIds: [categoryId]
  }
});

const accepted = await req(`/gigs/${gig.gig.id}/accept`, { method: "POST", token: worker.token });
console.log("accepted:", accepted.gig.status);

for (const status of ["WORKER_EN_ROUTE", "WORKER_ARRIVED", "IN_PROGRESS", "COMPLETED"]) {
  const updated = await req(`/gigs/${gig.gig.id}/status`, {
    method: "PATCH",
    token: worker.token,
    body: { status }
  });
  console.log("status:", updated.gig.status);
}

const clientGigs = await req("/gigs/mine?as=CLIENT", { token: client.token });
console.log("client_final:", clientGigs.gigs[0].status);

const review = await req(`/gigs/${gig.gig.id}/reviews`, {
  method: "POST",
  token: client.token,
  body: { rating: 5, comment: "Great worker, fast and professional." }
});
console.log("review:", review.review.rating);

const earnings = await req("/workers/earnings", { token: worker.token });
console.log("worker_earnings:", earnings.earnings.totalEarningsCents);
console.log("FLOW_OK");
