import { AppError, ErrorCodes } from "@rc/shared";
import type {
  Restaurant,
  RestaurantPhoto,
  RestaurantPhotoOptions,
  RestaurantProvider,
  RestaurantReview,
  RestaurantSearchRequest,
  RestaurantSearchResult
} from "./domain.ts";
import { DETAIL_REVIEW_LIMIT, FINALIST_PHOTO_LIMIT, SEARCH_PHOTO_LIMIT } from "./domain.ts";
import { restaurantCouncilId } from "./identity.ts";
import { haversineKm } from "./geo.ts";
import { metersToKm } from "./domain.ts";
import { placeholderSvg, typicalPriceRangeFromLevel } from "./enrichment.ts";
import type { RestaurantDetails } from "./types.ts";
import { restaurantToCandidate } from "./map-candidate.ts";

interface FixtureTemplate {
  id: string;
  name: string;
  priceLevel: 1 | 2 | 3 | 4;
  rating?: number;
  reviewCount?: number;
  photoCount?: number;
  cuisines: string[];
  offsetKm: number;
  bearingDeg: number;
  outdoorSeating: boolean;
  accessibility: string[];
  dietaryOptions: string[];
  address: string;
  hours: string;
  phone?: string;
  email?: string;
  website?: string;
  menuHighlights: string[];
  reviewSnippets?: Array<{ rating: number; text: string; authorName: string }>;
}

const FIXTURES: FixtureTemplate[] = [
  {
    id: "rst_stk",
    name: "STK",
    priceLevel: 4,
    rating: 4.4,
    reviewCount: 2143,
    photoCount: 3,
    cuisines: ["steak", "american"],
    offsetKm: 1.1,
    bearingDeg: 18,
    outdoorSeating: false,
    accessibility: ["wheelchair"],
    dietaryOptions: [],
    address: "Near downtown",
    hours: "5:00 PM – 11:00 PM",
    phone: "(212) 555-0144",
    website: "https://stk.example.com",
    menuHighlights: ["Dry-aged ribeye", "Truffle fries"],
    reviewSnippets: [
      { rating: 5, text: "Excellent steaks and great service.", authorName: "Alex R." },
      { rating: 4, text: "Lively room, prices are high but the ribeye is worth it.", authorName: "Jamie T." }
    ]
  },
  {
    id: "rst_grazianos",
    name: "Graziano's",
    priceLevel: 2,
    rating: 4.6,
    reviewCount: 832,
    photoCount: 2,
    cuisines: ["italian"],
    offsetKm: 0.8,
    bearingDeg: 210,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "gluten-free"],
    address: "Little Italy block",
    hours: "11:30 AM – 10:00 PM",
    phone: "(212) 555-0182",
    email: "hello@grazianos.example",
    website: "https://grazianos.example.com",
    menuHighlights: ["Cacio e pepe", "Margherita pizza"],
    reviewSnippets: [
      { rating: 5, text: "Great dinner and excellent service.", authorName: "Test User" }
    ]
  },
  {
    id: "rst_saigon_counter",
    name: "Saigon Counter",
    priceLevel: 1,
    rating: 4.5,
    cuisines: ["vietnamese"],
    offsetKm: 0.6,
    bearingDeg: 95,
    outdoorSeating: false,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "Market street",
    hours: "11:00 AM – 9:00 PM",
    phone: "(212) 555-0160",
    menuHighlights: ["Pho", "Tofu banh mi"]
  },
  {
    id: "rst_mesa_verde",
    name: "Mesa Verde",
    priceLevel: 2,
    rating: 4.3,
    cuisines: ["mexican"],
    offsetKm: 1.4,
    bearingDeg: 140,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "West park",
    hours: "12:00 PM – 10:00 PM",
    phone: "(212) 555-0133",
    email: "events@mesaverde.example",
    menuHighlights: ["Al pastor tacos", "Elote"]
  },
  {
    id: "rst_kiso",
    name: "Kiso",
    priceLevel: 3,
    rating: 4.7,
    cuisines: ["japanese", "sushi"],
    offsetKm: 1.8,
    bearingDeg: 300,
    outdoorSeating: false,
    accessibility: ["wheelchair"],
    dietaryOptions: ["gluten-free"],
    address: "Harbor row",
    hours: "5:00 PM – 10:30 PM",
    phone: "(212) 555-0197",
    website: "https://kiso.example.com",
    menuHighlights: ["Omakase set", "Vegetable roll"]
  },
  {
    id: "rst_olive_branch",
    name: "Olive Branch",
    priceLevel: 2,
    rating: 4.4,
    cuisines: ["mediterranean", "greek"],
    offsetKm: 0.9,
    bearingDeg: 260,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "Garden square",
    hours: "11:00 AM – 9:30 PM",
    phone: "(212) 555-0118",
    email: "reserve@olivebranch.example",
    website: "https://olivebranch.example.com",
    menuHighlights: ["Meze platter", "Lemon chicken"]
  },
  {
    id: "rst_lantern_thai",
    name: "Lantern Thai",
    priceLevel: 2,
    rating: 4.2,
    cuisines: ["thai"],
    offsetKm: 2.1,
    bearingDeg: 40,
    outdoorSeating: false,
    accessibility: [],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "East village",
    hours: "12:00 PM – 10:00 PM",
    menuHighlights: ["Green curry", "Pad see ew"]
  },
  {
    id: "rst_hearthside",
    name: "Hearthside",
    priceLevel: 3,
    rating: 4.5,
    cuisines: ["american", "farm-to-table"],
    offsetKm: 1.6,
    bearingDeg: 175,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "gluten-free"],
    address: "River walk",
    hours: "5:00 PM – 10:00 PM",
    menuHighlights: ["Wood-fired trout", "Seasonal salad"]
  },
  {
    id: "rst_plain_bowl",
    name: "Plain Bowl",
    priceLevel: 1,
    photoCount: 0,
    cuisines: ["american", "cafe"],
    offsetKm: 0.4,
    bearingDeg: 80,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "Civic plaza",
    hours: "8:00 AM – 8:00 PM",
    menuHighlights: ["Grain bowl", "Tomato soup"]
  },
  {
    id: "rst_ember_room",
    name: "Ember Room",
    priceLevel: 4,
    rating: 4.6,
    cuisines: ["steak", "french"],
    offsetKm: 2.4,
    bearingDeg: 330,
    outdoorSeating: false,
    accessibility: ["wheelchair"],
    dietaryOptions: [],
    address: "Hotel district",
    hours: "5:30 PM – 11:00 PM",
    menuHighlights: ["Chateaubriand", "Soufflé"]
  },
  {
    id: "rst_nori_bar",
    name: "Nori Bar",
    priceLevel: 2,
    rating: 4.0,
    cuisines: ["japanese"],
    offsetKm: 1.2,
    bearingDeg: 110,
    outdoorSeating: false,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian"],
    address: "Arcade lane",
    hours: "11:30 AM – 9:00 PM",
    menuHighlights: ["Ramen", "Cucumber maki"]
  },
  {
    id: "rst_casa_luna",
    name: "Casa Luna",
    priceLevel: 3,
    rating: 4.4,
    cuisines: ["mexican", "seafood"],
    offsetKm: 3.2,
    bearingDeg: 200,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["gluten-free"],
    address: "South ridge",
    hours: "4:00 PM – 10:00 PM",
    menuHighlights: ["Whole fish", "Tableside guacamole"]
  },
  {
    id: "rst_green_kiln",
    name: "Green Kiln",
    priceLevel: 2,
    rating: 4.8,
    reviewCount: 12,
    photoCount: 1,
    cuisines: ["vegan", "vegetarian"],
    offsetKm: 0.7,
    bearingDeg: 50,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    address: "Arts block",
    hours: "11:00 AM – 9:00 PM",
    menuHighlights: ["Roasted cauliflower", "Cashew alfredo"]
  },
  {
    id: "rst_bistro_nine",
    name: "Bistro Nine",
    priceLevel: 3,
    rating: 4.2,
    cuisines: ["french", "american"],
    offsetKm: 1.5,
    bearingDeg: 15,
    outdoorSeating: true,
    accessibility: ["wheelchair"],
    dietaryOptions: ["vegetarian", "gluten-free"],
    address: "Museum row",
    hours: "5:00 PM – 10:00 PM",
    menuHighlights: ["Steak frites", "Onion soup"]
  },
  {
    id: "rst_dumpling_house",
    name: "North Dumpling House",
    priceLevel: 1,
    rating: 4.6,
    cuisines: ["chinese"],
    offsetKm: 1.9,
    bearingDeg: 70,
    outdoorSeating: false,
    accessibility: [],
    dietaryOptions: ["vegetarian"],
    address: "Chinatown edge",
    hours: "11:00 AM – 9:30 PM",
    menuHighlights: ["Pork dumplings", "Cucumber salad"]
  },
  {
    id: "rst_ada_grill",
    name: "Ada Grill",
    priceLevel: 2,
    rating: 4.3,
    cuisines: ["american"],
    offsetKm: 1.0,
    bearingDeg: 240,
    outdoorSeating: false,
    accessibility: ["wheelchair", "step-free"],
    dietaryOptions: ["vegetarian", "gluten-free"],
    address: "Library corner",
    hours: "11:00 AM – 10:00 PM",
    menuHighlights: ["Turkey burger", "Chopped salad"]
  }
];

function destinationPoint(
  origin: { latitude: number; longitude: number },
  distanceKm: number,
  bearingDeg: number
): { latitude: number; longitude: number } {
  const radius = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.latitude * Math.PI) / 180;
  const lon1 = (origin.longitude * Math.PI) / 180;
  const angular = distanceKm / radius;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI
  };
}

function mockPhotos(template: FixtureTemplate, count: number): RestaurantPhoto[] | undefined {
  if (count <= 0) return undefined;
  return Array.from({ length: count }, (_, index) => ({
    provider: "mock" as const,
    providerPhotoId: `photo_${template.id}_${index + 1}`,
    width: index === 0 ? 1200 : 900,
    height: index === 0 ? 800 : 900,
    attribution: "Restaurant Council fixture"
  }));
}

function mockReviews(template: FixtureTemplate): RestaurantReview[] | undefined {
  const snippets = template.reviewSnippets;
  if (!snippets?.length) return undefined;
  return snippets.slice(0, DETAIL_REVIEW_LIMIT).map((snippet, index) => ({
    provider: "mock" as const,
    providerReviewId: `review_${template.id}_${index + 1}`,
    rating: snippet.rating,
    text: snippet.text,
    authorName: snippet.authorName,
    attribution: snippet.authorName
  }));
}

function toRestaurant(
  template: FixtureTemplate,
  origin: { latitude: number; longitude: number },
  mode: "search" | "details" = "search"
): Restaurant {
  const coords = destinationPoint(origin, template.offsetKm, template.bearingDeg);
  const photoCount = template.photoCount ?? 1;
  return {
    id: restaurantCouncilId("mock", template.id),
    provider: "mock",
    providerId: template.id,
    name: template.name,
    address: template.address,
    location: coords,
    cuisines: template.cuisines,
    priceLevel: template.priceLevel,
    priceRange: typicalPriceRangeFromLevel(template.priceLevel),
    rating: template.rating,
    reviewCount: template.reviewCount,
    photos: mockPhotos(
      template,
      mode === "details" ? Math.min(FINALIST_PHOTO_LIMIT, photoCount || 0) : Math.min(SEARCH_PHOTO_LIMIT, photoCount)
    ),
    reviews: mode === "details" ? mockReviews(template) : undefined,
    attributes: {
      outdoorSeating: template.outdoorSeating,
      vegetarian: template.dietaryOptions.includes("vegetarian")
    },
    openingHours: { weekdayText: [template.hours] },
    website: template.website,
    phone: template.phone,
    email: template.email,
    providerMetadata: {
      accessibility: template.accessibility,
      dietaryOptions: template.dietaryOptions,
      menuHighlights: template.menuHighlights
    }
  };
}

export class MockRestaurantProvider implements RestaurantProvider {
  readonly name = "mock" as const;

  async search(request: RestaurantSearchRequest): Promise<RestaurantSearchResult> {
    const origin = request.location;
    const radiusKm = metersToKm(request.radiusMeters);
    const restaurants = FIXTURES.map((template) => toRestaurant(template, origin, "search")).filter(
      (restaurant) => haversineKm(origin, restaurant.location) <= radiusKm + 0.05
    );
    return {
      restaurants,
      search: { provider: "mock", resultCount: restaurants.length }
    };
  }

  async getDetails(providerRestaurantId: string): Promise<Restaurant> {
    const template = FIXTURES.find((item) => item.id === providerRestaurantId);
    if (!template) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
    }
    return toRestaurant(template, { latitude: 40.758, longitude: -73.9855 }, "details");
  }

  async getPhotoUrl(
    photo: RestaurantPhoto,
    _options?: RestaurantPhotoOptions
  ): Promise<string> {
    if (photo.provider !== "mock") {
      throw new AppError(ErrorCodes.NOT_FOUND, "Photo not found", 404);
    }
    const template = FIXTURES.find((item) => photo.providerPhotoId.startsWith(`photo_${item.id}_`));
    return `data:image/svg+xml;utf8,${encodeURIComponent(placeholderSvg(template?.name ?? "Restaurant"))}`;
  }
}

export function mockRestaurantDetails(id: string): RestaurantDetails {
  const template = FIXTURES.find((item) => item.id === id || restaurantCouncilId("mock", item.id) === id);
  if (!template) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
  }
  const restaurant = toRestaurant(template, { latitude: 40.758, longitude: -73.9855 }, "details");
  const candidate = restaurantToCandidate(restaurant, undefined, { details: true });
  return {
    ...candidate,
    menuHighlights: template.menuHighlights
  };
}

