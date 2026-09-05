export const photos = {
  homeServices: "/images/stories/home-services.jpg",
  leadOwner: "/images/stories/lead-owner.jpg",
  officeTeam: "/images/stories/office-team.jpg",
  hospitality: "/images/stories/hospitality.jpg",
  realEstate: "/images/stories/real-estate.jpg",
  retail: "/images/stories/retail.jpg",
  professional: "/images/stories/professional.jpg",
  workspace: "/images/stories/workspace.jpg",
  documents: "/images/stories/documents.jpg",
  growthCleaning: "/images/stories/growth-cleaning.jpg",
  smeMarket: "/images/stories/sme-market.jpg",
  phoneCheck: "/images/stories/phone-check.jpg"
} as const;

export const industryGallery = [
  {
    id: "home-services",
    name: "Home Services",
    overlay: "Respond. Qualify. Book.",
    useCase: "Never miss a customer enquiry. Use AI to respond, qualify leads, schedule appointments and follow up.",
    image: photos.homeServices,
    alt: "Technician working on equipment in a home service environment"
  },
  {
    id: "professional",
    name: "Professional Services",
    overlay: "Automate the admin.",
    useCase: "Qualify new enquiries, answer common questions and free specialists for high-value work.",
    image: photos.professional,
    alt: "Professionals collaborating in a modern office"
  },
  {
    id: "real-estate",
    name: "Real Estate",
    overlay: "Capture every enquiry.",
    useCase: "Respond to property enquiries, qualify prospects and automate repetitive communication.",
    image: photos.realEstate,
    alt: "Modern residential property exterior"
  },
  {
    id: "retail",
    name: "Retail & E-commerce",
    overlay: "Answer customers instantly.",
    useCase: "Answer product questions, support customers and automate order-related communication.",
    image: photos.retail,
    alt: "Retail store interior with products on display"
  },
  {
    id: "hospitality",
    name: "Hospitality",
    overlay: "Serve customers faster.",
    useCase: "Handle booking questions, guest requests and routine communication around the clock.",
    image: photos.hospitality,
    alt: "Hospitality professional preparing food in a commercial kitchen"
  },
  {
    id: "growing",
    name: "Growing SMEs",
    overlay: "Start practical. Scale later.",
    useCase: "Start with one practical use case and expand AI as your team and demand grow.",
    image: photos.smeMarket,
    alt: "Entrepreneurs collaborating in a modern business setting"
  }
] as const;
