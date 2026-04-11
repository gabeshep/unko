// ─────────────────────────────────────────────────────────
// FOURSQUARE PLACES API v3
// Requests are routed through the places-api-service backend
// when window.PLACES_API_URL is set, keeping the API key
// server-side. Falls back to direct Foursquare calls when
// window.FOURSQUARE_API_KEY is available (local dev).
// ─────────────────────────────────────────────────────────
import { getTypeLabel, buildAddress } from './utils.js';

const FSQ_ENDPOINT   = 'https://api.foursquare.com/v3/places/search';
const RADII          = { eat: 1500, see: 2500, do: 3000 };
const FSQ_CATEGORIES = { eat: '13000', see: '16000', do: '10000,18000' };

/**
 * Fetches places for a given category near the provided coordinates.
 * @param {string} cat - 'eat' | 'do' | 'see'
 * @param {{ lat: number, lon: number, openNow: boolean }} opts
 * @returns {Promise<Array>} normalized place objects
 */
export async function fetchCategory(cat, { lat, lon, openNow }) {
  const backendUrl = window.PLACES_API_URL;

  let res;
  if (backendUrl) {
    // Route through backend proxy — API key stays server-side
    const url = new URL('/places/search', backendUrl);
    url.searchParams.set('ll', `${lat},${lon}`);
    url.searchParams.set('cat', cat);
    if (openNow) url.searchParams.set('open_now', 'true');
    res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Places API error: ${res.status}`);
  } else {
    // Direct Foursquare call for local development
    const apiKey = window.FOURSQUARE_API_KEY;
    if (!apiKey) throw new Error('Neither PLACES_API_URL nor FOURSQUARE_API_KEY is set');

    const url = new URL(FSQ_ENDPOINT);
    url.searchParams.set('ll', `${lat},${lon}`);
    url.searchParams.set('categories', FSQ_CATEGORIES[cat]);
    url.searchParams.set('radius', RADII[cat]);
    url.searchParams.set('limit', '50');
    url.searchParams.set('fields', 'fsq_id,name,categories,geocodes,location,hours');
    if (openNow) url.searchParams.set('open_now', 'true');
    res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`Foursquare API error: ${res.status}`);
  }

  const data = await res.json();

  return (data.results || [])
    .filter(p => p.name && p.geocodes?.main)
    .map(p => ({
      id:      p.fsq_id,
      name:    p.name,
      cat,
      type:    getTypeLabel(cat, p.categories),
      lat:     p.geocodes.main.latitude,
      lon:     p.geocodes.main.longitude,
      address: buildAddress(p.location),
      detail:  null
    }));
}
