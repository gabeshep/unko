// ─────────────────────────────────────────────────────────
// CONSTANTS & UTILITY HELPERS
// ─────────────────────────────────────────────────────────
export const catEmoji  = { do: '🎯', eat: '🍽️', see: '👁️' };
export const catColors = { do: '#1A6B72', eat: '#D45A2A', see: '#5B3E8A' };

export function getTypeLabel(cat, categories) {
  if (categories && categories.length > 0) return categories[0].short_name || categories[0].name;
  return cat === 'eat' ? 'Restaurant' : cat === 'see' ? 'Landmark' : 'Activity';
}

export function buildAddress(location) {
  if (!location) return null;
  return location.address || location.formatted_address || null;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const r  = Math.PI / 180;
  const dL = (lat2 - lat1) * r;
  const dO = (lon2 - lon1) * r;
  const a  = Math.sin(dL/2)**2 + Math.cos(lat1*r) * Math.cos(lat2*r) * Math.sin(dO/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function interleave(...arrays) {
  // Weight proportionally by array length so larger categories appear more
  // frequently throughout the pool, not just at the end after smaller ones
  // are exhausted (fixes uneven early-pool representation).
  const tagged = arrays.flatMap((arr, catIdx) =>
    arr.map((item, i) => ({ item, sort: (i + 0.5) / arr.length, catIdx }))
  );
  tagged.sort((a, b) => a.sort - b.sort || a.catIdx - b.catIdx);
  return tagged.map(t => t.item);
}
