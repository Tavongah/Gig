/**
 * Lightweight customer-text normalization for WhatsApp commerce.
 * Does not invent products/prices — only makes informal English easier to match.
 */

const WORD_NUMBERS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12"
};

/** Common spelling variants → catalog-friendly tokens (bounded). */
const SPELLING_FIXES: Array<[RegExp, string]> = [
  [/\bbred\b/g, "bread"],
  [/\bbreads\b/g, "bread"],
  [/\bsuger\b/g, "sugar"],
  [/\bsugr\b/g, "sugar"],
  [/\bmazo\b/g, "mazoe"],
  [/\bmaz oe\b/g, "mazoe"],
  [/\bcookin\b/g, "cooking"],
  [/\bmlk\b/g, "milk"],
  [/\begss\b/g, "eggs"],
  [/\beggss\b/g, "eggs"],
  [/\bcoka\s*cola\b/g, "coca cola"],
  [/\bcoka\b/g, "coke"]
];

/**
 * Normalize informal customer text for intent/entity matching.
 */
export function normalizeCustomerText(raw: string): {
  original: string;
  normalized: string;
} {
  const original = raw.trim();
  let t = original
    .toLowerCase()
    .normalize("NFKD")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  t = t.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
    (m, _g, offset: number, full: string) => {
      // Keep demonstrative "one" ("not that one", "the orange one")
      if (m === "one") {
        const before = full.slice(Math.max(0, offset - 12), offset);
        if (/\b(that|this|the|other|wrong|which|orange|big|small|cheap(?:er)?)\s+$/i.test(before)) {
          return m;
        }
      }
      return WORD_NUMBERS[m] ?? m;
    }
  );

  for (const [re, to] of SPELLING_FIXES) {
    t = t.replace(re, to);
  }

  t = t
    .replace(/\b(\d+)\s*l(?:itre|iter|trs?)?\b/g, "$1l")
    .replace(/\b(\d+)\s*kg\b/g, "$1kg")
    .replace(/\s+/g, " ")
    .trim();

  return { original, normalized: t };
}

/** Soft phrase rewrites that are safe commerce synonyms. */
export function applySafeCommercePhraseNormalizations(normalized: string): string {
  let t = normalized;

  t = t
    .replace(
      /\b(how much all|all how much|how much everything|what everything cost|everything cost|total how much|cost of all|all cost)\b/g,
      "check total"
    )
    .replace(
      /\b(that'?s it|thats it|finish(?: order)?|order now|send order|i want checkout|want checkout|place the order|yes that'?s everything|that'?s everything)\b/g,
      "checkout"
    )
    .replace(/\b(take|put)\s+(.+?)\s+out\b/g, "remove $2")
    .replace(/\btake out\s+(.+)$/g, "remove $1")
    .replace(/\b(don'?t|dont|do not)\s+want\s+(?:that\s+)?(.+)$/g, "remove $2")
    .replace(/\bi don'?t want\s+(?:that\s+)?(.+)$/g, "remove $1")
    .replace(/\bchange\s+(.+?)\s+to\s+(\d+)\b/g, "make $1 $2")
    .replace(/\bchange\s+(.+?)\s+(\d+)\b/g, "make $1 $2")
    .replace(/\b(\d+)\s+instead\b/g, "make it $1")
    .replace(/\b(give me|get me)\s+another\s+/g, "add another ")
    .replace(/\bshop got all\b/g, "do you have all these")
    .replace(/\byou have all these\b/g, "do you have all these")
    .replace(/^(.+?)\s+how much\s*$/g, "how much is $1")
    .replace(/^price\s+(.+)$/g, "how much is $1")
    .replace(/^(.+?)\s+is how much\s*$/g, "how much is $1")
    .replace(/\b(.+?)\s+there\s*$/g, (full, item) => {
      if (/^(do you have|have you got|is there|got|you have|shop have)\b/i.test(full)) {
        return full.replace(/\s+there\s*$/i, "").trim();
      }
      const words = String(item).trim().split(/\s+/);
      if (words.length <= 3 && !/\b(is|are|was|delivery|order)\b/.test(String(item))) {
        return `do you have ${String(item).trim()}`;
      }
      return full;
    });

  return t.replace(/\s+/g, " ").trim();
}

export function prepareCustomerTextForMatching(raw: string): string {
  const { normalized } = normalizeCustomerText(raw);
  return applySafeCommercePhraseNormalizations(normalized);
}

/** Soft prefixes often used before a shopping list. */
export function stripShoppingLeadIns(text: string): string {
  return text
    .replace(/^(i\s+)?(want|need|wanna|like)\s+/i, "")
    .replace(/^(give|get|bring)\s+(me\s+)?/i, "")
    .replace(/^please\s+/i, "")
    .trim();
}
