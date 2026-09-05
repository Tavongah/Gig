export const APP_URL = (import.meta.env.PUBLIC_APP_URL || "https://app.duts.tech").replace(/\/$/, "");
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || "https://www.duts.tech").replace(/\/$/, "");
export const SUPPORT_EMAIL = import.meta.env.PUBLIC_SUPPORT_EMAIL || "info@duts.tech";
export const SUPPORT_PHONE = import.meta.env.PUBLIC_SUPPORT_PHONE || "+12036769717";

export const BRAND = {
  name: "DUTS AI",
  tagline: "AI Solutions Built for Business Growth.",
  shortTagline: "Practical AI for real businesses."
} as const;

export const navLinks = [
  { label: "Products", href: "/products" },
  { label: "Solutions", href: "/solutions" },
  { label: "Industries", href: "/industries" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "Company", href: "/company" }
] as const;

export const solutions = [
  {
    id: "customer-assistant",
    name: "AI Customer Assistant",
    outcome: "Answer customers even when your team can't.",
    summary: "24/7 intelligent support trained on your business information.",
    capabilities: ["Website chat", "WhatsApp", "FAQs", "Service questions", "Lead capture", "Human handoff"]
  },
  {
    id: "lead-assistant",
    name: "AI Lead Assistant",
    outcome: "Turn more enquiries into customers.",
    summary: "Capture, qualify and follow up with potential customers automatically.",
    capabilities: ["Lead qualification", "Immediate response", "Follow-up", "Appointment booking", "CRM updates", "Lead routing"]
  },
  {
    id: "business-assistant",
    name: "AI Business Assistant",
    outcome: "Turn business knowledge into instant answers.",
    summary: "A private assistant that understands your company's knowledge.",
    capabilities: ["Website", "Documents", "Policies", "Price lists", "Services", "Knowledge bases"]
  },
  {
    id: "document-intelligence",
    name: "AI Document Intelligence",
    outcome: "Spend less time reading and processing documents manually.",
    summary: "Help your team understand and process documents faster.",
    capabilities: ["Summarization", "Extraction", "Classification", "Document Q&A", "Invoice data", "Contract search"]
  },
  {
    id: "workflow-automation",
    name: "AI Workflow Automation",
    outcome: "Automate the work that slows your team down.",
    summary: "Automate repetitive operational work across email, systems and tasks.",
    capabilities: ["Request understanding", "Data extraction", "System updates", "Task creation", "Draft responses", "Human approval"]
  },
  {
    id: "content-assistant",
    name: "AI Content Assistant",
    outcome: "Create better marketing without starting from zero.",
    summary: "Marketing content grounded in your brand and business information.",
    capabilities: ["Social content", "Ad copy", "Promotions", "Email", "Landing-page copy", "Campaign ideas"]
  },
  {
    id: "integrations",
    name: "AI Integrations",
    outcome: "Upgrade your existing systems instead of replacing everything.",
    summary: "Add AI to the tools your business already uses.",
    capabilities: ["CRM", "Existing websites", "Internal software", "Databases", "APIs", "Customer portals"]
  }
] as const;

export const products = [
  {
    name: "AI Landing Pages",
    description: "Conversion-focused pages built to generate leads and grow."
  },
  {
    name: "AI Lead Assistant",
    description: "Qualify and follow up with enquiries automatically."
  },
  {
    name: "AI Customer Assistant",
    description: "Always-on support trained on your business."
  },
  {
    name: "Business AI Workspace",
    description: "Internal answers from your company knowledge."
  }
] as const;

export const customSolutions = [
  { name: "Custom AI Agents", description: "Agents designed around your workflows." },
  { name: "Automation", description: "End-to-end operational automation." },
  { name: "Document AI", description: "Document understanding at scale." },
  { name: "AI Integrations", description: "AI inside your existing stack." },
  { name: "Internal AI Assistants", description: "Private assistants for your team." }
] as const;

export const industries = [
  {
    name: "Home Services",
    useCase: "Never miss a customer enquiry. Respond, qualify leads, schedule appointments and follow up."
  },
  {
    name: "Professional Services",
    useCase: "Qualify new enquiries, answer common questions and free specialists for high-value work."
  },
  {
    name: "Real Estate",
    useCase: "Respond to property enquiries, qualify prospects and automate repetitive communication."
  },
  {
    name: "Retail & E-commerce",
    useCase: "Answer product questions, support customers and automate order-related communication."
  },
  {
    name: "Hospitality",
    useCase: "Handle booking questions, guest requests and routine communication around the clock."
  },
  {
    name: "Healthcare",
    useCase: "Streamline appointment enquiries, FAQs and administrative follow-up with clear handoffs."
  },
  {
    name: "Education",
    useCase: "Support admissions questions, student enquiries and repetitive administrative tasks."
  },
  {
    name: "Growing SMEs",
    useCase: "Start with one practical use case and expand AI as your team and demand grow."
  }
] as const;

export const howSteps = [
  {
    n: "01",
    title: "Tell us about your business",
    body: "We learn how your business works, where time is being lost and where opportunities exist."
  },
  {
    n: "02",
    title: "Find the right AI opportunity",
    body: "We identify practical use cases where AI can deliver measurable value."
  },
  {
    n: "03",
    title: "Build and integrate",
    body: "DUTS builds the solution and connects it with the tools your business already uses."
  },
  {
    n: "04",
    title: "Improve and scale",
    body: "We monitor performance and expand the solution as your business grows."
  }
] as const;

export const principles = [
  {
    title: "Practical",
    body: "We start with the business problem, not the technology."
  },
  {
    title: "Connected",
    body: "Our solutions work with the tools and workflows businesses already use."
  },
  {
    title: "Human",
    body: "AI supports people instead of adding unnecessary complexity."
  },
  {
    title: "Built to grow",
    body: "Start with one use case and expand as the business grows."
  }
] as const;

export const trustLabels = [
  "Home Services",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Healthcare",
  "Hospitality",
  "Education",
  "Growing Teams"
] as const;

export const pathfinderOptions = [
  {
    id: "missed-enquiries",
    label: "We miss customer enquiries",
    solutions: ["AI Customer Assistant", "AI Lead Assistant"],
    message: "Respond instantly, capture the lead and continue the conversation automatically."
  },
  {
    id: "repetitive-work",
    label: "Our team spends too much time on repetitive work",
    solutions: ["AI Workflow Automation", "AI Business Assistant"],
    message: "Remove the busywork so your team can focus on higher-value work."
  },
  {
    id: "more-leads",
    label: "We need more leads",
    solutions: ["AI Landing Pages", "AI Lead Assistant"],
    message: "Turn traffic into qualified conversations with conversion-focused pages and follow-up."
  },
  {
    id: "support-load",
    label: "Customer support takes too much time",
    solutions: ["AI Customer Assistant"],
    message: "Answer common questions instantly and hand off only when a human is needed."
  },
  {
    id: "documents",
    label: "We have too many documents to process",
    solutions: ["AI Document Intelligence"],
    message: "Summarize, extract and search documents instead of reading everything by hand."
  },
  {
    id: "existing-software",
    label: "We want to add AI to our existing software",
    solutions: ["AI Integrations", "Custom AI Agents"],
    message: "Upgrade the systems you already rely on without replacing your whole stack."
  },
  {
    id: "unsure",
    label: "We don't know where to start",
    solutions: ["Discovery conversation"],
    message: "We'll map your workflow and recommend one practical starting point."
  }
] as const;

export const markets = ["United States", "South Africa", "Zimbabwe"] as const;
