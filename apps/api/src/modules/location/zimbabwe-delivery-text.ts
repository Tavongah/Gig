export const PILOT_CITIES = [
  "gweru",
  "harare",
  "bulawayo",
  "mutare",
  "masvingo",
  "kwekwe",
  "chitungwiza",
  "epworth"
] as const;

export type ParsedDeliveryText = {
  original: string;
  normalized: string;
  house?: string;
  street?: string;
  suburb?: string;
  city?: string;
  landmark?: string;
  country?: string;
};

function titlePlace(value: string): string {
  return value
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export function normalizeDeliveryQuery(raw: string): string {
  return String(raw ?? "")
    .replace(/[，、]/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .trim();
}

function findCity(text: string): { city?: string; withoutCity: string } {
  const lower = text.toLowerCase();
  const found = [...PILOT_CITIES].sort((a, b) => b.length - a.length).find((city) => {
    const re = new RegExp(`\\b${city}\\b`, "i");
    return re.test(lower);
  });
  if (!found) return { withoutCity: text };
  const withoutCity = text.replace(new RegExp(`\\b${found}\\b`, "ig"), " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s+/g, " ").replace(/^,|,$/g, "").trim();
  return { city: titlePlace(found), withoutCity };
}

export function parseZimbabweDeliveryText(raw: string): ParsedDeliveryText {
  const original = String(raw ?? "").trim();
  let rest = normalizeDeliveryQuery(original);

  let country: string | undefined;
  if (/\bzimbabwe\b/i.test(rest) || /\bzimbabwe\b/i.test(original)) {
    country = "Zimbabwe";
    rest = rest.replace(/,?\s*\bzimbabwe\b/gi, "").replace(/\s+/g, " ").replace(/^,|,$/g, "").trim();
  }

  const cityFound = findCity(rest);
  rest = cityFound.withoutCity;
  const city = cityFound.city;

  let landmark: string | undefined;
  const landmarkMatch = rest.match(/\b(?:near|close to|opposite|next to)\s+(.+)$/i);
  if (landmarkMatch?.[1]) {
    landmark = landmarkMatch[1].replace(/[,\s]+$/g, "").trim();
    rest = rest.slice(0, landmarkMatch.index).replace(/[,\s]+$/g, "").trim();
  }

  let house: string | undefined;
  const houseMatch = rest.match(/^(\d+[a-zA-Z]?)\b/);
  if (houseMatch) {
    house = houseMatch[1];
    rest = rest.slice(houseMatch[0].length).replace(/^[,\s]+/, "").trim();
  }

  const chunks = rest
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  let street: string | undefined;
  let suburb: string | undefined;
  if (chunks.length >= 2) {
    street = titlePlace(chunks[0]!);
    suburb = titlePlace(chunks.slice(1).join(" "));
  } else if (chunks.length === 1) {
    const words = chunks[0]!.split(/\s+/).filter(Boolean);
    if (house && words.length >= 2) {
      street = titlePlace(words[0]!);
      suburb = titlePlace(words.slice(1).join(" "));
    } else if (house && words.length === 1) {
      street = titlePlace(words[0]!);
    } else {
      suburb = titlePlace(chunks[0]!);
    }
  }

  return {
    original,
    normalized: normalizeDeliveryQuery(original),
    house,
    street: street || undefined,
    suburb: suburb || undefined,
    city,
    landmark: landmark ? titlePlace(landmark) : undefined,
    country
  };
}

export function progressiveDeliveryQueries(parsed: ParsedDeliveryText): string[] {
  const city = parsed.city;
  const suburb = parsed.suburb;
  const street = parsed.street;
  const house = parsed.house;
  const landmark = parsed.landmark;
  const queries: string[] = [];
  const push = (value: string) => {
    const q = normalizeDeliveryQuery(value);
    if (q.length >= 3 && !queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q);
  };

  if (house && street && suburb && city) push(`${house} ${street}, ${suburb}, ${city}, Zimbabwe`);
  if (street && suburb && city) push(`${street}, ${suburb}, ${city}, Zimbabwe`);
  if (suburb && city) push(`${suburb}, ${city}, Zimbabwe`);
  if (landmark && suburb && city) push(`${landmark}, ${suburb}, ${city}, Zimbabwe`);
  if (landmark && city) push(`${landmark}, ${city}, Zimbabwe`);
  if (landmark) push(`${landmark}, Zimbabwe`);
  if (parsed.normalized) push(parsed.normalized);
  if (parsed.normalized && !/\bzimbabwe\b/i.test(parsed.normalized)) push(`${parsed.normalized}, Zimbabwe`);
  return queries;
}

export function recoveryKind(parsed: ParsedDeliveryText): "need_city" | "need_area" | "need_landmark" | "none" {
  if (!parsed.city) return "need_city";
  if (!parsed.suburb && !parsed.landmark) return "need_area";
  return "need_landmark";
}
