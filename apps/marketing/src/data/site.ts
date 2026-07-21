export const APP_URL = (import.meta.env.PUBLIC_APP_URL || "https://app.gigflow.ink").replace(/\/$/, "");
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || "https://www.gigflow.ink").replace(/\/$/, "");
export const SUPPORT_EMAIL = import.meta.env.PUBLIC_SUPPORT_EMAIL || "support@gigflow.ink";
export const SUPPORT_PHONE = import.meta.env.PUBLIC_SUPPORT_PHONE || "+12036769717";
export const SUPPORT_HOURS = import.meta.env.PUBLIC_SUPPORT_HOURS || "Monday – Saturday · 8:00 AM – 8:00 PM (Eastern Time)";

export const appLinks = {
  home: APP_URL,
  login: APP_URL,
  requestHelp: APP_URL,
  becomeWorker: APP_URL,
  privacy: `${APP_URL}`,
  terms: `${APP_URL}`
} as const;

export interface ServiceDef {
  slug: string;
  name: string;
  short: string;
  description: string;
  startingFromCents: number;
  icon: string;
  image: string;
  includes: string[];
  faqs: Array<{ q: string; a: string }>;
}

export const services: ServiceDef[] = [
  {
    slug: "moving-assistance",
    name: "Moving Assistance",
    short: "Loading, unloading, and local moving help from trusted workers.",
    description:
      "Get help loading, unloading, and moving items locally. DUTS connects you with nearby workers ready to lift, haul, and finish the job faster.",
    startingFromCents: 6000,
    icon: "truck",
    image: "/images/services/moving.jpg",
    includes: ["Loading and unloading help", "Local short-distance moves", "Furniture and box handling", "On-demand or scheduled help"],
    faqs: [
      { q: "Do workers bring a truck?", a: "Some workers may have a vehicle; confirm details in chat after matching." },
      { q: "Can I book same-day moving help?", a: "Yes—urgency options help match available nearby workers quickly." }
    ]
  },
  {
    slug: "house-cleaning",
    name: "House Cleaning",
    short: "Whole-home cleaning from verified local professionals.",
    description: "Book trusted local cleaners for apartments and houses. Clear expectations, transparent starting prices, and fast matching.",
    startingFromCents: 4500,
    icon: "sparkles",
    image: "/images/services/house-cleaning.jpg",
    includes: ["Whole-home cleaning", "Kitchen and bathroom focus", "Flexible scheduling", "Verified local workers"],
    faqs: [
      { q: "Do I need to provide supplies?", a: "Share preferences in your request. Many workers bring basics; specialty products can be noted in the job details." },
      { q: "How long does a house clean take?", a: "It depends on size and condition. Your estimate and worker chat help set expectations before work starts." }
    ]
  },
  {
    slug: "room-cleaning",
    name: "Room Cleaning",
    short: "Single-room cleaning and light organization.",
    description: "Need one space refreshed? Room cleaning is ideal for bedrooms, offices, and focused tidy-ups without booking a full-home clean.",
    startingFromCents: 2500,
    icon: "home",
    image: "/images/services/room-cleaning.jpg",
    includes: ["Single-room focus", "Light organization", "Quick turnaround options", "Affordable starting rates"],
    faqs: [
      { q: "Can I book multiple rooms?", a: "Yes—describe each room in your request or create separate jobs if you prefer clearer pricing." }
    ]
  },
  {
    slug: "lawn-cutting",
    name: "Lawn Cutting",
    short: "Mowing, edging, and yard cleanup from local pros.",
    description: "Keep your yard sharp with local lawn help for mowing, edging, and basic cleanup—matched nearby so you don't wait on a distant crew.",
    startingFromCents: 3500,
    icon: "leaf",
    image: "/images/services/lawn-cutting.jpg",
    includes: ["Mowing", "Edging", "Basic yard cleanup", "Neighborhood-based matching"],
    faqs: [
      { q: "Do I need to own a mower?", a: "Many workers bring equipment. Mention if tools are on-site or if the worker should arrive equipped." }
    ]
  },
  {
    slug: "short-term-labor",
    name: "Short-Term Labor",
    short: "Flexible hands for projects, setups, and one-off tasks.",
    description: "Extra hands for projects, setups, and one-off tasks. Describe the work, match a worker nearby, and get it done.",
    startingFromCents: 5000,
    icon: "hammer",
    image: "/images/services/short-term-labor.jpg",
    includes: ["Flexible task support", "Project and event labor", "Short or multi-hour jobs", "Local matching"],
    faqs: [
      { q: "What kind of labor can I request?", a: "General local help—lifting, setup, cleanup, and similar tasks. Be specific in your description for the best match." }
    ]
  },
  {
    slug: "car-detailing",
    name: "Car Detailing",
    short: "Interior and exterior detailing at your location.",
    description: "Interior and exterior vehicle detailing from local pros. Request help, match nearby, and get your car looking sharp.",
    startingFromCents: 5000,
    icon: "car",
    image: "/images/services/car-detailing.jpg",
    includes: ["Interior detailing", "Exterior wash and detail options", "Flexible scheduling", "Secure in-app payments"],
    faqs: [
      { q: "Is water and power required on-site?", a: "Share access details in your request so the worker can prepare correctly." }
    ]
  },
  {
    slug: "furniture-assembly",
    name: "Furniture Assembly",
    short: "Flat-pack furniture and fixture assembly done right.",
    description: "From flat-pack furniture to fixtures, get matched with nearby workers who can assemble it right the first time.",
    startingFromCents: 4000,
    icon: "wrench",
    image: "/images/services/furniture-assembly.jpg",
    includes: ["Flat-pack assembly", "Fixtures and basic setup", "On-site completion", "Photo and chat coordination"],
    faqs: [
      { q: "Should I open the boxes first?", a: "Optional—workers can start from sealed packaging if you note it in the job description." }
    ]
  },
  {
    slug: "junk-removal",
    name: "Junk Removal",
    short: "Haul away unwanted items and light debris.",
    description: "Clear out unwanted items and light debris with local junk-removal help. Fast matching, clear starting prices, and secure payment.",
    startingFromCents: 5500,
    icon: "trash",
    image: "/images/services/junk-removal.jpg",
    includes: ["Household item removal", "Light debris haul-away", "Loading help", "Transparent estimates"],
    faqs: [
      { q: "Are disposal fees included?", a: "Starting prices cover labor estimates. Disposal or dump fees may vary—confirm in chat before work begins." }
    ]
  },
  {
    slug: "event-help",
    name: "Event Help",
    short: "Setup, teardown, and on-site event assistance.",
    description: "Setup, teardown, and on-site support for gatherings and events. Match local workers who can show up ready to help.",
    startingFromCents: 4500,
    icon: "calendar",
    image: "/images/services/event-help.jpg",
    includes: ["Event setup", "Teardown support", "On-site assistance", "Flexible timing"],
    faqs: [
      { q: "Can I book multiple workers?", a: "You can request help and coordinate through DUTS. For larger events, describe headcount needs clearly in the job details." }
    ]
  }
];

export function formatFromCents(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export function getService(slug: string): ServiceDef | undefined {
  return services.find((s) => s.slug === slug);
}

export interface CityDef {
  slug: string;
  name: string;
  state: string;
  blurb: string;
}

export const cities: CityDef[] = [
  {
    slug: "hartford",
    name: "Hartford",
    state: "CT",
    blurb: "Book trusted local help across Hartford for moving, cleaning, lawn care, and more—matched nearby in minutes."
  },
  {
    slug: "new-haven",
    name: "New Haven",
    state: "CT",
    blurb: "From Yale-area apartments to family homes, DUTS connects New Haven customers with verified local workers fast."
  },
  {
    slug: "bridgeport",
    name: "Bridgeport",
    state: "CT",
    blurb: "Need help in Bridgeport? Request a service and get matched with nearby workers for everyday jobs."
  },
  {
    slug: "stamford",
    name: "Stamford",
    state: "CT",
    blurb: "Stamford residents use DUTS for reliable local help—cleaning, moving assistance, assembly, and more."
  }
];

export const trustItems = [
  { title: "Verified Workers", body: "Every worker completes registration and approval before taking jobs.", icon: "shield" },
  { title: "Fast Matching", body: "Your request reaches nearby available workers in minutes.", icon: "bolt" },
  { title: "Secure Payments", body: "Pay through Stripe-powered checkout. No cash handoffs.", icon: "lock" },
  { title: "Transparent Pricing", body: "See starting prices up front. No surprises.", icon: "tag" },
  { title: "Reliable Service", body: "Track progress, chat in-app, and approve when done.", icon: "check" },
  { title: "Local Professionals", body: "Work with people in your community who know the area.", icon: "pin" }
];

export const whyDuts = [
  { title: "Built for trust", body: "Account checks, secure payments, and clear job details.", icon: "shield" },
  { title: "Designed for speed", body: "Match with nearby workers without long wait times.", icon: "bolt" },
  { title: "Made for your neighborhood", body: "Local workers. Local jobs. Real community impact.", icon: "pin" },
  { title: "Simple from start to finish", body: "Request, match, pay, and done—all in one app.", icon: "check" }
];

export const socialProof = [
  { value: "4.9", label: "Average Rating", sub: "Placeholder" },
  { value: "2,500+", label: "Jobs Completed", sub: "Placeholder" },
  { value: "500+", label: "Workers Available", sub: "Placeholder" },
  { value: "4+", label: "Cities Served", sub: "Connecticut" }
];

export const howSteps = [
  { step: 1, title: "Choose a Service", body: "Pick from cleaning, moving, lawn care, assembly, and more." },
  { step: 2, title: "Describe Your Job", body: "Add location, timing, and details so workers know what's needed." },
  { step: 3, title: "Get Matched", body: "Nearby workers respond. Choose who feels right and secure payment." },
  { step: 4, title: "Job Completed", body: "Track progress, stay in chat, approve completion—you're done." }
];

export const faqs = [
  {
    q: "How do I request help?",
    a: "Open the DUTS app, choose a service, describe the job, and submit your request. Nearby workers can respond so you can pick the right match."
  },
  {
    q: "How do I pay?",
    a: "Payments are handled securely in the app through Stripe. You'll confirm payment before work proceeds according to the job flow."
  },
  {
    q: "How quickly can I get matched?",
    a: "It depends on location, time, and worker availability. Many requests get interest quickly when workers nearby are online."
  },
  {
    q: "Can I cancel a booking?",
    a: "Yes—cancellation options depend on job status. You can manage active gigs in the app and contact support if you need help."
  },
  {
    q: "How are workers verified?",
    a: "Workers complete registration and approval steps before taking jobs. Always review profiles and chat details before confirming."
  },
  {
    q: "How do I become a worker?",
    a: "Tap Become a Worker in the app, complete your profile, get approved, then go online to see nearby gigs."
  },
  {
    q: "What services are available?",
    a: "Launch services include moving assistance, house and room cleaning, lawn cutting, short-term labor, car detailing, furniture assembly, junk removal, and event help."
  }
];

export const workerBenefits = [
  { title: "Your schedule", body: "Go online when you're free and accept nearby jobs that fit your day." },
  { title: "Flexible income", body: "Turn spare time into earnings with local gigs in your area." },
  { title: "Jobs nearby", body: "See opportunities close to you so travel stays practical." },
  { title: "Simple onboarding", body: "Create your profile, get approved, and start exploring work." }
];
