const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh",
];

const STATE_ABBREVIATIONS: Record<string, string> = {
  up: "Uttar Pradesh",
  "u.p": "Uttar Pradesh",
  "u.p.": "Uttar Pradesh",
  tn: "Tamil Nadu",
  "t.n": "Tamil Nadu",
  "t.n.": "Tamil Nadu",
  wb: "West Bengal",
  "w.b": "West Bengal",
  "w.b.": "West Bengal",
  mh: "Maharashtra",
  hr: "Haryana",
  "h.r": "Haryana",
  pb: "Punjab",
  gj: "Gujarat",
  ka: "Karnataka",
  kt: "Karnataka",
  ts: "Telangana",
  mp: "Madhya Pradesh",
  rj: "Rajasthan",
};

const CITY_TO_STATE: Record<string, string> = {
  chennai: "Tamil Nadu",
  madras: "Tamil Nadu",
  coimbatore: "Tamil Nadu",
  noida: "Uttar Pradesh",
  ghaziabad: "Uttar Pradesh",
  lucknow: "Uttar Pradesh",
  kanpur: "Uttar Pradesh",
  varanasi: "Uttar Pradesh",
  agra: "Uttar Pradesh",
  mirzapur: "Uttar Pradesh",
  meerut: "Uttar Pradesh",
  gurugram: "Haryana",
  gurgaon: "Haryana",
  hisar: "Haryana",
  faridabad: "Haryana",
  panipat: "Haryana",
  mohali: "Punjab",
  jalandhar: "Punjab",
  ludhiana: "Punjab",
  amritsar: "Punjab",
  chandigarh: "Chandigarh",
  kolkata: "West Bengal",
  calcutta: "West Bengal",
  howrah: "West Bengal",
  mumbai: "Maharashtra",
  bombay: "Maharashtra",
  pune: "Maharashtra",
  nagpur: "Maharashtra",
  nashik: "Maharashtra",
  aurangabad: "Maharashtra",
  thane: "Maharashtra",
  bangalore: "Karnataka",
  bengaluru: "Karnataka",
  mysore: "Karnataka",
  mysuru: "Karnataka",
  hubli: "Karnataka",
  mangalore: "Karnataka",
  hyderabad: "Telangana",
  secunderabad: "Telangana",
  ahmedabad: "Gujarat",
  surat: "Gujarat",
  vadodara: "Gujarat",
  rajkot: "Gujarat",
  jaipur: "Rajasthan",
  jodhpur: "Rajasthan",
  udaipur: "Rajasthan",
  kochi: "Kerala",
  cochin: "Kerala",
  trivandrum: "Kerala",
  thiruvananthapuram: "Kerala",
  kozhikode: "Kerala",
  bhubaneswar: "Odisha",
  cuttack: "Odisha",
  indore: "Madhya Pradesh",
  bhopal: "Madhya Pradesh",
  jabalpur: "Madhya Pradesh",
  patna: "Bihar",
  ranchi: "Jharkhand",
  raipur: "Chhattisgarh",
  guwahati: "Assam",
  dehradun: "Uttarakhand",
  shimla: "Himachal Pradesh",
  srinagar: "Jammu and Kashmir",
  jammu: "Jammu and Kashmir",
  delhi: "Delhi",
  "new delhi": "Delhi",
  ncr: "Delhi",
  goa: "Goa",
  panaji: "Goa",
  pondicherry: "Puducherry",
  puducherry: "Puducherry",
};

const COUNTRIES = [
  "India",
  "United States",
  "USA",
  "UK",
  "United Kingdom",
  "Singapore",
  "United Arab Emirates",
  "UAE",
  "Australia",
  "Canada",
  "Germany",
  "Japan",
  "China",
  "France",
  "Netherlands",
  "Switzerland",
  "Italy",
  "Spain",
  "Brazil",
  "South Africa",
  "New Zealand",
];

const INTERNATIONAL_CITY_TO_COUNTRY: Record<string, string> = {
  "new york": "United States",
  nyc: "United States",
  "los angeles": "United States",
  "san francisco": "United States",
  chicago: "United States",
  houston: "United States",
  "washington dc": "United States",
  boston: "United States",
  london: "United Kingdom",
  manchester: "United Kingdom",
  birmingham: "United Kingdom",
  singapore: "Singapore",
  dubai: "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  sharjah: "United Arab Emirates",
  sydney: "Australia",
  melbourne: "Australia",
  brisbane: "Australia",
  perth: "Australia",
  toronto: "Canada",
  vancouver: "Canada",
  montreal: "Canada",
  berlin: "Germany",
  munich: "Germany",
  frankfurt: "Germany",
  hamburg: "Germany",
  tokyo: "Japan",
  osaka: "Japan",
  kyoto: "Japan",
  beijing: "China",
  shanghai: "China",
  shenzhen: "China",
  paris: "France",
  amsterdam: "Netherlands",
  zurich: "Switzerland",
  geneva: "Switzerland",
  rome: "Italy",
  milan: "Italy",
  madrid: "Spain",
  barcelona: "Spain",
  "sao paulo": "Brazil",
  "rio de janeiro": "Brazil",
  johannesburg: "South Africa",
  auckland: "New Zealand",
  wellington: "New Zealand",
};

function normalizeCountry(country: string): string {
  switch (country.toUpperCase()) {
    case "USA":
    case "US":
      return "United States";
    case "UK":
      return "United Kingdom";
    case "UAE":
      return "United Arab Emirates";
    default:
      return country;
  }
}

function matchKnownCountry(segment: string): string | null {
  const lower = segment.toLowerCase();
  const found = COUNTRIES.find((c) => {
    if (c.toLowerCase() === lower) return true;
    if (lower.includes(c.toLowerCase())) return true;
    return false;
  });
  return found ? normalizeCountry(found) : null;
}

function matchKnownState(segment: string): string | null {
  const lower = segment.trim().toLowerCase();
  const found = INDIAN_STATES.find((s) => {
    if (s.toLowerCase() === lower) return true;
    if (lower.includes(s.toLowerCase())) return true;
    return false;
  });
  return found ?? null;
}

function matchStateAbbreviation(segment: string): string | null {
  const cleaned = segment
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  return STATE_ABBREVIATIONS[cleaned] ?? null;
}

function matchCity(segment: string): string | null {
  const cleaned = segment.trim().toLowerCase();

  // Exact match first (e.g. "gurugram")
  if (CITY_TO_STATE[cleaned]) return CITY_TO_STATE[cleaned];

  // Partial match so "Gurugram 122008" or "New Delhi-110048" still resolve.
  // Prefer the longest city name to avoid short-name false positives.
  const matches = Object.keys(CITY_TO_STATE).filter((city) =>
    cleaned.includes(city)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.length - a.length);
  return CITY_TO_STATE[matches[0]];
}

function matchInternationalCity(segment: string): string | null {
  const cleaned = segment.trim().toLowerCase();

  if (INTERNATIONAL_CITY_TO_COUNTRY[cleaned]) {
    return INTERNATIONAL_CITY_TO_COUNTRY[cleaned];
  }

  const matches = Object.keys(INTERNATIONAL_CITY_TO_COUNTRY).filter((city) =>
    cleaned.includes(city)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.length - a.length);
  return INTERNATIONAL_CITY_TO_COUNTRY[matches[0]];
}

function segmentsFrom(text: string): string[] {
  return text
    .split(/[,;/()\[\]—–-]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type LocationInput = {
  companyLocation?: string | null;
  address?: string | null;
};

export function deriveStateCountry(
  input: LocationInput
): { state: string | null; country: string | null } {
  const texts = [input.companyLocation, input.address].filter(
    (t): t is string => !!t && t.trim().length > 0
  );

  if (texts.length === 0) {
    return { state: null, country: null };
  }

  let state: string | null = null;
  let country: string | null = null;

  for (const text of texts) {
    const segments = segmentsFrom(text);

    for (const segment of segments) {
      if (!country) {
        country = matchKnownCountry(segment);
        if (!country) country = matchInternationalCity(segment);
      }

      if (!state) {
        state =
          matchKnownState(segment) ??
          matchStateAbbreviation(segment) ??
          matchCity(segment);
      }

      if (state && country) break;
    }

    if (state && country) break;
  }

  // India default: if we detected an Indian state/city but no explicit
  // country word was found, assume India (addresses like "Mohali 160055").
  if (!country && (state || texts.some((t) => matchKnownCountry(t) || /india/i.test(t)))) {
    country = "India";
  }

  return { state, country };
}

// Curated city -> [lat, lng] table for map points. Mirrors CITY_TO_STATE so
// known cities resolve instantly without a network call.
export const CITY_COORDS: Record<string, [number, number]> = {
  chennai: [13.0827, 80.2707],
  madras: [13.0827, 80.2707],
  coimbatore: [11.0168, 76.9558],
  noida: [28.5355, 77.391],
  ghaziabad: [28.6692, 77.4538],
  lucknow: [26.8467, 80.9462],
  kanpur: [26.4499, 80.3319],
  varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081],
  mirzapur: [25.1449, 82.5653],
  meerut: [28.9845, 77.7064],
  gurugram: [28.4595, 77.0266],
  gurgaon: [28.4595, 77.0266],
  hisar: [29.1492, 75.7217],
  faridabad: [28.4089, 77.3178],
  panipat: [29.3909, 76.9635],
  mohali: [30.7046, 76.7179],
  jalandhar: [31.326, 75.5762],
  ludhiana: [30.901, 75.8573],
  amritsar: [31.634, 74.8723],
  chandigarh: [30.7333, 76.7794],
  kolkata: [22.5726, 88.3639],
  calcutta: [22.5726, 88.3639],
  howrah: [22.5958, 88.2636],
  mumbai: [19.076, 72.8777],
  bombay: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  nagpur: [21.1458, 79.0882],
  nashik: [19.9975, 73.7898],
  aurangabad: [19.8762, 75.3433],
  thane: [19.2183, 72.9781],
  bangalore: [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  mysore: [12.2958, 76.6394],
  mysuru: [12.2958, 76.6394],
  hubli: [15.3647, 75.124],
  mangalore: [12.9141, 74.856],
  hyderabad: [17.385, 78.4867],
  secunderabad: [17.4399, 78.4983],
  ahmedabad: [23.0225, 72.5714],
  surat: [21.1702, 72.8311],
  vadodara: [22.3072, 73.1812],
  rajkot: [22.3039, 70.8022],
  jaipur: [26.9124, 75.7873],
  jodhpur: [26.2389, 73.0243],
  udaipur: [24.5854, 73.7125],
  kochi: [9.9312, 76.2673],
  cochin: [9.9312, 76.2673],
  trivandrum: [8.5241, 76.9366],
  thiruvananthapuram: [8.5241, 76.9366],
  kozhikode: [11.2588, 75.7804],
  bhubaneswar: [20.2961, 85.8245],
  cuttack: [20.4625, 85.8828],
  indore: [22.7196, 75.8577],
  bhopal: [23.2599, 77.4126],
  jabalpur: [23.1815, 79.9864],
  patna: [25.5941, 85.1376],
  ranchi: [23.3441, 85.3096],
  raipur: [21.2514, 81.6296],
  guwahati: [26.1445, 91.7362],
  dehradun: [30.3165, 78.0322],
  shimla: [31.1048, 77.1734],
  srinagar: [34.0837, 74.7973],
  jammu: [32.7266, 74.857],
  delhi: [28.7041, 77.1025],
  "new delhi": [28.6139, 77.209],
  ncr: [28.6139, 77.209],
  goa: [15.2993, 74.124],
  panaji: [15.4909, 73.8278],
  pondicherry: [11.9416, 79.8083],
  puducherry: [11.9416, 79.8083],
  london: [51.5074, -0.1278],
  "new york": [40.7128, -74.006],
  nyc: [40.7128, -74.006],
  singapore: [1.3521, 103.8198],
  dubai: [25.2048, 55.2708],
  sydney: [-33.8688, 151.2093],
  toronto: [43.6532, -79.3832],
  "sao paulo": [-23.5505, -46.6333],
};

function matchCityCoords(segment: string): [number, number] | null {
  const cleaned = segment.trim().toLowerCase();

  if (CITY_COORDS[cleaned]) return CITY_COORDS[cleaned];

  const matches = Object.keys(CITY_COORDS).filter((city) =>
    cleaned.includes(city)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.length - a.length);
  return CITY_COORDS[matches[0]];
}

const GEOCODE_CACHE = new Map<string, [number, number] | null>();
let lastGeocodeAt = 0;

export async function geocodeFallback(
  location: string
): Promise<[number, number] | null> {
  const key = location.trim().toLowerCase();
  if (GEOCODE_CACHE.has(key)) return GEOCODE_CACHE.get(key) ?? null;

  // Nominatim requires ~1 request/sec; pace calls.
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Cardfile business-card-scanner" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const point = data[0];
    const coords: [number, number] | null = point
      ? [parseFloat(point.lat), parseFloat(point.lon)]
      : null;
    GEOCODE_CACHE.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

export async function resolveLocationCoords(
  input: LocationInput
): Promise<[number, number] | null> {
  const texts = [input.companyLocation, input.address].filter(
    (t): t is string => !!t && t.trim().length > 0
  );

  if (texts.length === 0) return null;

  // 1) Curated city table — instant, offline.
  for (const text of texts) {
    for (const segment of segmentsFrom(text)) {
      const coords = matchCityCoords(segment);
      if (coords) return coords;
    }
  }

  // 2) Free geocode fallback for unmatched locations.
  for (const text of texts) {
    const coords = await geocodeFallback(text);
    if (coords) return coords;
  }

  return null;
}
