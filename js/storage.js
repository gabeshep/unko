// ─────────────────────────────────────────────────────────
// PROFILE & SAVED PLACES — persistent via localStorage
// ─────────────────────────────────────────────────────────
const STORAGE_PROFILE = 'unko_profile';
const STORAGE_SAVED   = 'unko_saved_places';

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PROFILE)) || { name: '', email: '' }; }
  catch { return { name: '', email: '' }; }
}

export function persistProfile(profile) {
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
}

export function loadSavedPlaces() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SAVED)) || []; }
  catch { return []; }
}

export function persistSavedPlaces(places) {
  localStorage.setItem(STORAGE_SAVED, JSON.stringify(places));
}
