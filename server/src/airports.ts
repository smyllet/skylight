// Fetches airport data from OurAirports CSV exports, caches them on disk,
// and provides filtered results by geographic proximity.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const AIRPORTS_CSV_URL = "https://ourairports.com/data/airports.csv";
const RUNWAYS_CSV_URL = "https://ourairports.com/data/runways.csv";

// TTL for cache refresh (7 days)
const CACHE_TTL_MS = 7 * 24 * 3600_000;

export interface CsvAirport {
  id: string;
  ident: string;
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  elevation_ft: string;
  iso_country: string;
  municipality: string;
  scheduled_service: string;
  icao_code: string;
  iata_code: string;
}

export interface CsvRunway {
  airport_ident: string;
  airport_ref: string;
  le_ident: string;
  he_ident: string;
  le_latitude_deg: string;
  le_longitude_deg: string;
  he_latitude_deg: string;
  he_longitude_deg: string;
  width_ft: string;
  length_ft: string;
}

export interface Runway {
  leIdent: string;
  heIdent: string;
  le: [number, number];
  he: [number, number];
  widthFt: number;
}

export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  runways: Runway[];
}

/** Parse a CSV line into an object using the header row */
function parseCsvLine<T>(line: string, headers: string[]): T | null {
  const values = parseCsvLineRaw(line);
  if (values.length !== headers.length) return null;
  
  const obj: Partial<T> = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i] as keyof T] = values[i] as any;
  }
  return obj as T;
}

/** Simple CSV line parser (handles quoted values) */
function parseCsvLineRaw(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Download a CSV file and return its lines */
async function downloadCsv(url: string): Promise<string[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  return text.split(/\r?\n/).filter(l => l.trim().length > 0);
}

/** Parse airports CSV */
async function fetchAirports(): Promise<CsvAirport[]> {
  const lines = await downloadCsv(AIRPORTS_CSV_URL);
  const headers = parseCsvLineRaw(lines[0]);
  
  const airports: CsvAirport[] = [];
  for (let i = 1; i < lines.length; i++) {
    const airport = parseCsvLine<CsvAirport>(lines[i], headers);
    if (airport && airport.icao_code) {
      airports.push(airport);
    }
  }
  return airports;
}

/** Parse runways CSV */
async function fetchRunways(): Promise<CsvRunway[]> {
  const lines = await downloadCsv(RUNWAYS_CSV_URL);
  const headers = parseCsvLineRaw(lines[0]);
  
  const runways: CsvRunway[] = [];
  for (let i = 1; i < lines.length; i++) {
    const runway = parseCsvLine<CsvRunway>(lines[i], headers);
    if (runway && runway.airport_ident && runway.le_latitude_deg && runway.le_longitude_deg) {
      runways.push(runway);
    }
  }
  return runways;
}

export class AirportStore {
  private airports: CsvAirport[] = [];
  private runways: CsvRunway[] = [];
  private fetchedAt = 0;

  constructor(
    private cacheDir: string,
    private airportsCachePath: string,
    private runwaysCachePath: string,
  ) {}

  async load(): Promise<void> {
    // Try loading from cache
    try {
      const airportsRaw = await readFile(this.airportsCachePath, "utf8");
      const runwaysRaw = await readFile(this.runwaysCachePath, "utf8");
      const airportsCache = JSON.parse(airportsRaw) as { at: number; data: CsvAirport[] };
      const runwaysCache = JSON.parse(runwaysRaw) as { at: number; data: CsvRunway[] };
      
      if (airportsCache.data && runwaysCache.data) {
        this.airports = airportsCache.data;
        this.runways = runwaysCache.data;
        this.fetchedAt = Math.max(airportsCache.at, runwaysCache.at);
      }
    } catch {
      /* first run or cache invalid */
    }
    
    // Refresh if cache is stale
    if (Date.now() - this.fetchedAt > CACHE_TTL_MS) {
      await this.refresh();
    }
    
    // Periodic refresh
    setInterval(() => void this.refresh(), CACHE_TTL_MS).unref?.();
  }

  async refresh(): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      
      const [airports, runways] = await Promise.all([
        fetchAirports(),
        fetchRunways(),
      ]);
      
      this.airports = airports;
      this.runways = runways;
      this.fetchedAt = Date.now();
      
      await Promise.all([
        writeFile(
          this.airportsCachePath,
          JSON.stringify({ at: this.fetchedAt, data: airports }),
          "utf8",
        ),
        writeFile(
          this.runwaysCachePath,
          JSON.stringify({ at: this.fetchedAt, data: runways }),
          "utf8",
        ),
      ]);
      
      console.log(`[airports] refreshed ${airports.length} airports, ${runways.length} runways`);
    } catch (err) {
      console.error(
        "[airports] refresh failed (using cache):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Get airports near a center point
   * Filters for airports with scheduled service or large airports
   */
  getNearby(lat: number, lon: number, radiusMiles: number = 50): Airport[] {
    if (this.airports.length === 0) return [];
    
    const result: Airport[] = [];
    const radiusDeg = radiusMiles / 69; // Approx: 1 degree ≈ 69 miles
    
    // Filter airports by proximity and type
    const nearbyAirports = this.airports.filter(ap => {
      const apLat = parseFloat(ap.latitude_deg);
      const apLon = parseFloat(ap.longitude_deg);
      if (isNaN(apLat) || isNaN(apLon)) return false;
      
      // Quick bounding box filter
      if (Math.abs(apLat - lat) > radiusDeg || Math.abs(apLon - lon) > radiusDeg) {
        return false;
      }
      
      // Filter: scheduled service or large airports
      const isScheduled = ap.scheduled_service === "yes";
      const isLarge = ap.type === "large_airport" || ap.type === "medium_airport";
      if (!isScheduled && !isLarge) return false;
      
      return true;
    });
    
    // Build airport objects with runways
    for (const ap of nearbyAirports) {
      const apLat = parseFloat(ap.latitude_deg);
      const apLon = parseFloat(ap.longitude_deg);
      
      // Calculate exact distance (great circle approximation)
      const distance = calculateDistance(lat, lon, apLat, apLon);
      if (distance > radiusMiles) continue;
      
      const airportRunways: Runway[] = [];
      
      // Find runways for this airport (match by icao_code or ident)
      for (const rw of this.runways) {
        const matchesIcao = rw.airport_ident === ap.icao_code;
        const matchesId = String(rw.airport_ref) === String(ap.id);
        
        if (matchesIcao || matchesId) {
          const leLat = parseFloat(rw.le_latitude_deg);
          const leLon = parseFloat(rw.le_longitude_deg);
          const heLat = parseFloat(rw.he_latitude_deg);
          const heLon = parseFloat(rw.he_longitude_deg);
          const widthFt = parseFloat(rw.width_ft) || 150;
          
          if (!isNaN(leLat) && !isNaN(leLon) && !isNaN(heLat) && !isNaN(heLon)) {
            airportRunways.push({
              leIdent: rw.le_ident || "",
              heIdent: rw.he_ident || "",
              le: [leLat, leLon],
              he: [heLat, heLon],
              widthFt,
            });
          }
        }
      }
      
      if (airportRunways.length > 0 || ap.icao_code === "KSFO") {
        result.push({
          icao: ap.icao_code || ap.ident || "",
          name: ap.name || ap.ident || "",
          lat: apLat,
          lon: apLon,
          runways: airportRunways,
        });
      }
    }
    
    return result;
  }
}

/**
 * Calculate great-circle distance between two points (Haversine formula)
 * Returns distance in statute miles
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ / 2) ** 2 + 
            Math.cos(φ1) * Math.cos(φ2) * 
            Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

export function createAirportStore(dataDir: string): AirportStore {
  const store = new AirportStore(
    dataDir,
    resolve(dataDir, "airports-cache.json"),
    resolve(dataDir, "runways-cache.json"),
  );
  return store;
}
