// Airport geometry loaded from API, drawn at true geographic position so departures and
// arrivals visibly line up with the runways. Data from OurAirports.

import type { Config } from "@shared/index.js";

export interface Runway {
  leIdent: string;
  heIdent: string;
  le: [number, number]; // [lat, lon]
  he: [number, number];
  widthFt: number;
}

export interface Airport {
  icao: string;
  name: string;
  runways: Runway[];
}

/** Default fallback airport (SFO) in case API fails */
export const FALLBACK_AIRPORTS: Airport[] = [
  {
    icao: "KSFO",
    name: "SFO",
    runways: [
      { leIdent: "10L", heIdent: "28R", le: [37.628742, -122.39341], he: [37.613538, -122.35716], widthFt: 200 },
      { leIdent: "10R", heIdent: "28L", le: [37.626298, -122.393124], he: [37.61172, -122.358367], widthFt: 200 },
      { leIdent: "1L", heIdent: "19R", le: [37.607898, -122.38295], he: [37.626476, -122.37063], widthFt: 200 },
      { leIdent: "1R", heIdent: "19L", le: [37.606333, -122.381061], he: [37.627346, -122.367124], widthFt: 200 },
    ],
  },
];

// Cache for loaded airports
let airportsCache: Airport[] | null = null;
let airportsPromise: Promise<Airport[]> | null = null;

/**
 * Fetch airports near the center from the server API.
 * Caches the result for the same center coordinates.
 */
export async function loadAirports(config: Config): Promise<Airport[]> {
  // Return cached airports if already loaded
  if (airportsCache) {
    return airportsCache;
  }
  
  // Return existing promise if a fetch is already in progress
  if (airportsPromise) {
    return airportsPromise;
  }
  
  airportsPromise = fetchAirportsFromApi(config);
  
  try {
    airportsCache = await airportsPromise;
    return airportsCache;
  } finally {
    airportsPromise = null;
  }
}

/**
 * Reset the airports cache (e.g., when center changes)
 */
export function resetAirportsCache(): void {
  airportsCache = null;
  airportsPromise = null;
}

/**
 * Fetch airports from the server API
 */
async function fetchAirportsFromApi(config: Config): Promise<Airport[]> {
  try {
    const radius = config.radiusMiles || 50;
    const url = `/api/airports?lat=${config.centerLat}&lon=${config.centerLon}&radius=${radius}`;
    
    const res = await fetch(url);
    
    if (!res.ok) {
      console.warn(`[airports] API request failed: ${res.status}`);
      return FALLBACK_AIRPORTS;
    }
    
    const data = await res.json();
    
    // Validate and transform the data to match the expected Airport interface
    const airports: Airport[] = [];
    
    for (const item of data) {
      if (item.icao && item.name) {
        const runways: Runway[] = [];
        
        if (Array.isArray(item.runways)) {
          for (const rw of item.runways) {
            if (rw.le && rw.he && Array.isArray(rw.le) && Array.isArray(rw.he)) {
              runways.push({
                leIdent: rw.leIdent || "",
                heIdent: rw.heIdent || "",
                le: [rw.le[0], rw.le[1]],
                he: [rw.he[0], rw.he[1]],
                widthFt: rw.widthFt || 200,
              });
            }
          }
        }
        
        // If no runways found but we have lat/lon, create a basic airport
        if (runways.length === 0 && item.lat !== undefined && item.lon !== undefined) {
          // Try to create a simple runway representation
          runways.push({
            leIdent: "RWY",
            heIdent: "RWY",
            le: [item.lat, item.lon],
            he: [item.lat + 0.01, item.lon],
            widthFt: 200,
          });
        }
        
        airports.push({
          icao: item.icao,
          name: item.name,
          runways,
        });
      }
    }
    
    // If no airports found, return fallback
    if (airports.length === 0) {
      console.warn("[airports] No airports found from API, using fallback");
      return FALLBACK_AIRPORTS;
    }
    
    console.log(`[airports] Loaded ${airports.length} airports`);
    return airports;
    
  } catch (err) {
    console.error("[airports] Failed to load from API:", err);
    return FALLBACK_AIRPORTS;
  }
}

/**
 * For backward compatibility, export AIRPORTS as a getter that returns
 * the loaded airports or fallback if not yet loaded.
 * Note: This is synchronous and will return fallback until loadAirports() is called.
 */
export function getAirports(): Airport[] {
  return airportsCache || FALLBACK_AIRPORTS;
}
