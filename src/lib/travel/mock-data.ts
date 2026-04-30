import { CandidatePlace, SourceRef } from "./types";

const source = (city: string, topic: string): SourceRef[] => [
  {
    title: `${city} tourism board - ${topic}`,
    url: `https://example.com/${city.toLowerCase().replaceAll(" ", "-")}/${topic.toLowerCase().replaceAll(" ", "-")}`,
    confidence: 0.82
  },
  {
    title: `${city} traveler discussion - ${topic}`,
    url: `https://example.com/community/${city.toLowerCase().replaceAll(" ", "-")}`,
    confidence: 0.68
  }
];

const common = (city: string): CandidatePlace[] => [
  {
    id: "old-town-core",
    name: "Old Town Core",
    category: "history",
    area: "Historic center",
    priority: 95,
    estimatedDurationMinutes: 120,
    expectedCost: 12,
    tags: ["history", "architecture", "first-time"],
    whyVisit: "The densest cluster of landmark streets, squares, and orientation points.",
    sources: source(city, "Old Town Core")
  },
  {
    id: "central-market",
    name: "Central Market",
    category: "food",
    area: "Market district",
    priority: 82,
    estimatedDurationMinutes: 80,
    expectedCost: 22,
    tags: ["food", "local", "budget"],
    whyVisit: "Efficient way to sample local food without losing half a day.",
    sources: source(city, "Central Market")
  },
  {
    id: "city-viewpoint",
    name: "City Viewpoint",
    category: "viewpoint",
    area: "Upper quarter",
    priority: 78,
    estimatedDurationMinutes: 70,
    expectedCost: 8,
    tags: ["views", "photo", "sunset"],
    whyVisit: "Good finale stop with low planning risk and strong memory value.",
    sources: source(city, "City Viewpoint")
  },
  {
    id: "local-neighborhood",
    name: "Local Neighborhood Walk",
    category: "culture",
    area: "Residential quarter",
    priority: 74,
    estimatedDurationMinutes: 110,
    expectedCost: 10,
    tags: ["local", "walk", "culture"],
    whyVisit: "Balances famous sights with a lower-friction local experience.",
    sources: source(city, "Local Neighborhood")
  },
  {
    id: "signature-museum",
    name: "Signature Museum",
    category: "museum",
    area: "Museum quarter",
    priority: 88,
    estimatedDurationMinutes: 150,
    expectedCost: 24,
    tags: ["museum", "art", "history"],
    whyVisit: "A high-signal museum stop for travelers who want context.",
    sources: source(city, "Signature Museum")
  },
  {
    id: "riverfront-route",
    name: "Riverfront Route",
    category: "walk",
    area: "Waterfront",
    priority: 70,
    estimatedDurationMinutes: 90,
    expectedCost: 0,
    tags: ["walk", "views", "relaxed"],
    whyVisit: "A flexible buffer activity that keeps the day scenic without extra cost.",
    sources: source(city, "Riverfront Route")
  }
];

export function getSeedPlaces(city: string): CandidatePlace[] {
  const normalized = city.trim().toLowerCase();

  if (normalized.includes("istanbul")) {
    return [
      {
        id: "sultanahmet",
        name: "Sultanahmet Cluster",
        category: "history",
        area: "Sultanahmet",
        priority: 98,
        estimatedDurationMinutes: 210,
        expectedCost: 32,
        tags: ["history", "architecture", "first-time"],
        whyVisit: "Hagia Sophia, Blue Mosque, and surrounding imperial core are the strongest first-day anchor.",
        sources: source(city, "Sultanahmet")
      },
      {
        id: "grand-bazaar",
        name: "Grand Bazaar",
        category: "shopping",
        area: "Beyazit",
        priority: 84,
        estimatedDurationMinutes: 90,
        expectedCost: 18,
        tags: ["shopping", "culture", "indoor"],
        whyVisit: "A practical indoor cultural stop near the historic core.",
        sources: source(city, "Grand Bazaar")
      },
      ...common(city)
    ];
  }

  if (normalized.includes("rome")) {
    return [
      {
        id: "colosseum-forum",
        name: "Colosseum and Forum",
        category: "history",
        area: "Ancient Rome",
        priority: 99,
        estimatedDurationMinutes: 210,
        expectedCost: 28,
        tags: ["history", "architecture", "first-time"],
        whyVisit: "The strongest ancient-history anchor and worth planning around.",
        sources: source(city, "Colosseum Forum")
      },
      {
        id: "trastevere",
        name: "Trastevere Evening",
        category: "food",
        area: "Trastevere",
        priority: 86,
        estimatedDurationMinutes: 120,
        expectedCost: 30,
        tags: ["food", "nightlife", "local"],
        whyVisit: "Good evening cluster for food, walking, and atmosphere.",
        sources: source(city, "Trastevere")
      },
      ...common(city)
    ];
  }

  return common(city);
}
