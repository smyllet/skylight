// Unit conversion utilities for metric/imperial display.
// Internal data remains in imperial (miles, feet, knots) but can be displayed in metric.

// Conversion factors
const FT_TO_M = 0.3048;    // 1 foot = 0.3048 meters
const MI_TO_KM = 1.60934;  // 1 mile = 1.60934 kilometers
const KTS_TO_KMH = 1.852;  // 1 knot = 1.852 km/h
const NM_TO_KM = 1.852;   // 1 nautical mile = 1.852 km

/**
 * Format altitude for display based on unit system.
 * Input is always in feet (from ADS-B data).
 */
export function formatAltitude(ft: number | null | undefined, unitSystem: string): string {
  if (ft == null || ft < 0) return "";
  if (unitSystem === "metric") {
    const meters = Math.round(ft * FT_TO_M);
    return meters > 999 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
  }
  const rounded = Math.round(ft / 100) * 100; // Round to nearest 100ft
  return `${rounded}ft`;
}

/**
 * Format distance for display based on unit system.
 * Input is always in statute miles.
 */
export function formatDistance(mi: number, unitSystem: string): string {
  if (unitSystem === "metric") {
    const km = mi * MI_TO_KM;
    return km > 9.999 ? `${km.toFixed(1)}km` : `${(km * 1000).toFixed(0)}m`;
  }
  return mi > 9.999 ? `${mi.toFixed(1)}mi` : `${(mi * 5280).toFixed(0)}ft`;
}

/**
 * Format nautical distance (from TLE/satellite calculations) for display.
 * Input is in nautical miles.
 */
export function formatNauticalDistance(nm: number, unitSystem: string): string {
  if (unitSystem === "metric") {
    const km = nm * NM_TO_KM;
    return km > 9.999 ? `${km.toFixed(1)}km` : `${(km * 1000).toFixed(0)}m`;
  }
  return nm > 9.999 ? `${nm.toFixed(1)}nm` : `${(nm * 6076.12).toFixed(0)}ft`;
}

/**
 * Format speed for display based on unit system.
 * Input is always in knots (from ADS-B data).
 */
export function formatSpeed(knots: number | null | undefined, unitSystem: string): string {
  if (knots == null || knots <= 0) return "";
  if (unitSystem === "metric") {
    const kmh = Math.round(knots * KTS_TO_KMH);
    return `${kmh}km/h`;
  }
  return `${Math.round(knots)}kn`;
}

/**
 * Format vertical speed for display based on unit system.
 * Input is in feet per minute.
 */
export function formatVerticalSpeed(fpm: number | null | undefined, unitSystem: string): string {
  if (fpm == null) return "";
  if (unitSystem === "metric") {
    const mps = fpm * FT_TO_M / 60; // feet/min -> meters/sec
    return fpm >= 0 ? `+${Math.round(mps * 10)}m/s` : `${Math.round(mps * 10)}m/s`;
  }
  return fpm >= 0 ? `+${fpm}ft/min` : `${fpm}ft/min`;
}

/**
 * Get the raw conversion factors for internal calculations if needed.
 */
export const Units = {
  FT_TO_M,
  MI_TO_KM,
  KTS_TO_KMH,
  NM_TO_KM,
} as const;
