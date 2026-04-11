import { track } from './analytics.js';
import { loadProfile, persistProfile, loadSavedPlaces, persistSavedPlaces } from './storage.js';
import { catEmoji, catColors, haversineMeters, formatDist, shuffle, interleave } from './utils.js';
import { fetchCategory } from './api.js';

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
const state = {
  lat: null,
  lon: null,
  locationReady: false,
  activeCategory: null,   // null | 'do' | 'eat' | 'see'
  openNow: false,         // filter to currently open places
  pool: [],               // normalized suggestion objects
  index: 0,
  browsing: false,        // true once first results are shown
  loading: false,
  seenIds: new Set()      // IDs of suggestions already shown
};

// Init persistent data
let savedPlaces = loadSavedPlaces();

// ─────────────────────────────────────────────────────────
// SAVED PLACES HELPERS
// ─────────────────────────────────────────────────────────
function isSaved(id) {
  return savedPlaces.some(p => p.id === id);
}

function toggleSavePlace() {
  const s = state.pool[state.index];
  if (!s) return;

  if (isSaved(s.id)) {
    savedPlaces = savedPlaces.filter(p => p.id !== s.id);
    track('place_unsaved', { category: s.cat });
  } else {
    savedPlaces = [{ id: s.id, name: s.name, cat: s.cat, type: s.type,
                     lat: s.lat, lon: s.lon, address: s.address,
                     savedAt: Date.now() }, ...savedPlaces];
    track('place_saved', { category: s.cat });
  }
  persistSavedPlaces(savedPlaces);
  updateSaveBtn(s.id);
  updateProfileBtnBadge();
}

function updateSaveBtn(id) {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  const saved = isSaved(id);
  btn.innerHTML = saved ? '♥' : '♡';
  btn.classList.toggle('saved', saved);
  btn.title = saved ? 'Remove from saved places' : 'Save this place';
}

function updateProfileBtnBadge() {
  const btn = document.getElementById('profileBtn');
  if (btn) btn.classList.toggle('has-saves', savedPlaces.length > 0);
}

// ─────────────────────────────────────────────────────────
// DRAWER (PLACES & PROFILE PANEL)
// ─────────────────────────────────────────────────────────
function openPlacesPanel() {
  renderDrawer();
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('placesDrawer').classList.add('open');
  track('places_panel_opened', { savedCount: savedPlaces.length });
}

function closePlacesPanel() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('placesDrawer').classList.remove('open');
}

function renderDrawer() {
  const profile = loadProfile();
  const body = document.getElementById('drawerBody');

  const savedHtml = savedPlaces.length === 0
    ? `<div class="saved-empty">No saved places yet.<br>Tap ♡ on a suggestion to save it here.</div>`
    : savedPlaces.map(p => {
        const emoji = catEmoji[p.cat] || '📍';
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}+${p.lat},${p.lon}`;
        return `
          <div class="saved-place-item" id="saved-${p.id}">
            <div class="saved-place-icon">${emoji}</div>
            <div class="saved-place-info">
              <div class="saved-place-name">${p.name}</div>
              <div class="saved-place-meta">${p.type}${p.address ? ' · ' + p.address : ''}</div>
            </div>
            <div class="saved-place-actions">
              <button class="btn-saved-map" data-url="${mapsUrl}" title="Open in Maps">🗺️</button>
              <button class="btn-saved-remove" data-id="${p.id}" title="Remove">✕</button>
            </div>
          </div>`;
      }).join('');

  const profileName  = profile.name  || '';
  const profileEmail = profile.email || '';
  body.innerHTML = `
    <div class="profile-section">
      <div class="section-label">Profile</div>
      <div class="profile-row" id="profileDisplay">
        <div class="profile-avatar">🧭</div>
        <div class="profile-name-wrap">
          <div class="profile-name-display">${profileName || 'Anonymous explorer'}</div>
          <div class="profile-name-hint">${profileEmail || (profileName ? 'Your display name' : 'Add your name &amp; email')}</div>
        </div>
        <button class="btn-edit-profile" id="editProfileBtn">Edit</button>
      </div>
      <div class="profile-edit-form hidden" id="profileEditForm">
        <input class="profile-name-input" id="profileNameInput" type="text"
          placeholder="Your name" maxlength="32" value="${profileName}">
        <input class="profile-name-input" id="profileEmailInput" type="email"
          placeholder="Your email (optional)" maxlength="128" value="${profileEmail}">
        <button class="btn-save-name" id="saveProfileBtn">Save →</button>
      </div>
    </div>
    <div class="saved-section">
      <div class="section-label">Saved places (${savedPlaces.length})</div>
      ${savedHtml}
    </div>
  `;

  // Wire up drawer-internal event listeners after render
  document.getElementById('editProfileBtn')?.addEventListener('click', showProfileEditForm);
  document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfileName);
  document.getElementById('profileNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveProfileName(); });
  document.getElementById('profileEmailInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveProfileName(); });

  // Event delegation for saved place action buttons
  body.addEventListener('click', e => {
    const removeBtn = e.target.closest('.btn-saved-remove');
    if (removeBtn) { removeSavedPlace(removeBtn.dataset.id); return; }

    const mapBtn = e.target.closest('.btn-saved-map');
    if (mapBtn) { window.open(mapBtn.dataset.url, '_blank'); }
  });
}

function showProfileEditForm() {
  document.getElementById('profileDisplay').classList.add('hidden');
  document.getElementById('profileEditForm').classList.remove('hidden');
  document.getElementById('profileNameInput').focus();
}

function saveProfileName() {
  const nameInput  = document.getElementById('profileNameInput');
  const emailInput = document.getElementById('profileEmailInput');
  const name  = nameInput  ? nameInput.value.trim()  : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const profile = loadProfile();
  profile.name  = name;
  profile.email = email;
  persistProfile(profile);
  track('profile_saved', { hasEmail: !!email });
  renderDrawer();
}

function removeSavedPlace(id) {
  savedPlaces = savedPlaces.filter(p => p.id !== id);
  persistSavedPlaces(savedPlaces);
  updateProfileBtnBadge();
  // Update save button if this is the currently shown suggestion
  const current = state.pool[state.index];
  if (current && current.id === id) updateSaveBtn(id);
  renderDrawer();
  track('place_removed_from_list');
}

// ─────────────────────────────────────────────────────────
// OPEN NOW TOGGLE
// ─────────────────────────────────────────────────────────
function toggleOpenNow() {
  state.openNow = !state.openNow;
  document.getElementById('openNowBtn').classList.toggle('active', state.openNow);
  track('open_now_toggled', { enabled: state.openNow });

  if (state.browsing) {
    state.pool  = [];
    state.index = 0;
    fetchSuggestions();
  }
}

// ─────────────────────────────────────────────────────────
// GEOLOCATION
// ─────────────────────────────────────────────────────────
function initLocation() {
  if (!navigator.geolocation) {
    setLocationLabel('Location unavailable', false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      state.locationReady = true;
      document.getElementById('locationDot').classList.add('active');
      setLocationLabel('Location found', true);
      track('location_granted');

      // Try to get a human-readable city name
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${state.lat}&lon=${state.lon}&zoom=12`
        );
        const data = await res.json();
        const city = data.address?.city
          || data.address?.town
          || data.address?.village
          || data.address?.county;
        if (city) setLocationLabel(city, true);
      } catch { /* non-critical, silently ignore */ }
    },
    () => {
      setLocationLabel('Enable location', false);
      setButtons('error');
      showZeroState('location', 'Allow location access in your browser settings, then refresh the page to find places near you.');
      track('location_denied');
    },
    { enableHighAccuracy: false, timeout: 12000 }
  );
}

function setLocationLabel(text, active) {
  document.getElementById('locationText').textContent = text;
  document.getElementById('locationDot').classList.toggle('active', active);
}

// ─────────────────────────────────────────────────────────
// CATEGORY TOGGLE
// ─────────────────────────────────────────────────────────
function toggleCategory(cat) {
  const btn = document.querySelector(`[data-cat="${cat}"]`);
  const alreadyActive = state.activeCategory === cat;

  // Deselect all first
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));

  if (alreadyActive) {
    state.activeCategory = null;
  } else {
    state.activeCategory = cat;
    btn.classList.add('active');
  }

  track('category_toggled', { category: state.activeCategory });

  // If already browsing, reset pool and re-fetch for the new filter
  if (state.browsing) {
    state.pool  = [];
    state.index = 0;
    fetchSuggestions();
  }
}

// ─────────────────────────────────────────────────────────
// API ORCHESTRATION
// ─────────────────────────────────────────────────────────
async function fetchSuggestions() {
  if (!state.locationReady) {
    setButtons('error');
    showZeroState('location', 'Still waiting for your location. Please allow location access and try again.');
    return;
  }
  if (state.loading) return;
  state.loading = true;

  showLoading();
  track('search_started', { category: state.activeCategory });

  try {
    const cats = state.activeCategory
      ? [state.activeCategory]
      : ['eat', 'do', 'see'];

    const { lat, lon, openNow } = state;
    const results = await Promise.all(cats.map(cat => fetchCategory(cat, { lat, lon, openNow })));

    let pool;
    if (cats.length === 1) {
      pool = shuffle(results[0]);
    } else {
      // Interleave categories so they alternate, then shuffle within groups
      pool = interleave(
        shuffle(results[0]),
        shuffle(results[1]),
        shuffle(results[2])
      );
    }

    // Filter out already-seen suggestions
    const unfilteredCount = pool.length;
    pool = pool.filter(el => !state.seenIds.has(el.id));

    if (pool.length === 0) {
      if (unfilteredCount > 0) {
        // All results have been seen — clear seenIds and cycle through again
        state.seenIds.clear();
        state.loading = false;
        fetchSuggestions();
        return;
      }
      setButtons('error');
      const emptyMsg = state.openNow
        ? "Nothing open nearby right now. Try turning off the Open now filter, or check back later."
        : "Try a different category, or check back when you're somewhere with more going on.";
      showZeroState('empty', emptyMsg);
      track('search_empty', { category: state.activeCategory, openNow: state.openNow });
      state.loading = false;
      return;
    }

    state.pool    = pool;
    state.index   = 0;
    state.browsing = true;
    state.loading  = false;

    track('search_succeeded', { category: state.activeCategory, resultCount: pool.length });
    showSuggestion();

  } catch (err) {
    console.error(err); // eslint-disable-line no-console
    state.loading = false;
    track('search_failed', { category: state.activeCategory, error: err.message });
    showError(
      'Could not load nearby places. Check your connection and try again.',
      'Try Again →',
      fetchSuggestions
    );
  }
}

// ─────────────────────────────────────────────────────────
// UI RENDERING
// ─────────────────────────────────────────────────────────
function showLoading() {
  setButtons('loading');
  document.getElementById('cardArea').innerHTML = `
    <div class="loading-card">
      <div class="spinner"></div>
      <div class="loading-msg">Finding what's nearby…</div>
    </div>`;
}

// variant: 'start' | 'location' | 'empty' | 'error'
const ZERO_STATE_META = {
  start:    { icon: '🧭', title: 'What\'s your next adventure?', rings: true  },
  location: { icon: '📍', title: 'Location needed',              rings: false },
  empty:    { icon: '🔍', title: 'Nothing found nearby',         rings: false },
  error:    { icon: '⚡', title: 'Something went wrong',         rings: false },
};

function showZeroState(variant, body, actionLabel, actionFn) {
  const meta = ZERO_STATE_META[variant] || ZERO_STATE_META.error;
  const actionHtml = actionLabel
    ? `<button id="errorActionBtn" class="btn-go" style="margin-top:4px;max-width:220px">${actionLabel}</button>`
    : '';
  document.getElementById('cardArea').innerHTML = `
    <div class="zero-state" data-variant="${variant}">
      <div class="zero-icon-wrap">
        <div class="zero-ring"></div>
        <div class="zero-ring"></div>
        <div class="zero-ring"></div>
        <span class="zero-icon">${meta.icon}</span>
      </div>
      <div class="zero-title">${meta.title}</div>
      <div class="zero-body">${body}</div>
      ${actionHtml}
    </div>`;
  if (actionLabel && actionFn) {
    document.getElementById('errorActionBtn').addEventListener('click', actionFn);
  }
}

function showError(msg, actionLabel, actionFn) {
  setButtons('error');
  showZeroState('error', msg, actionLabel, actionFn);
}

function showSuggestion() {
  const s = state.pool[state.index];
  if (!s) {
    // Pool exhausted — clear seenIds so the user can cycle through again
    state.seenIds.clear();
    state.pool  = [];
    state.index = 0;
    fetchSuggestions();
    return;
  }

  // Skip malformed suggestion objects that are missing required properties
  const isValid = typeof s.name === 'string' && s.name.trim() !== '' &&
                  typeof s.lat  === 'number'  && isFinite(s.lat) &&
                  typeof s.lon  === 'number'  && isFinite(s.lon) &&
                  typeof s.cat  === 'string'  && s.cat in catColors;

  if (!isValid) {
    state.index++;
    showSuggestion();
    return;
  }

  try {
    const dist    = haversineMeters(state.lat, state.lon, s.lat, s.lon);
    const detail  = s.detail ? ` · ${s.detail}` : '';
    const addrLine = s.address
      ? `<div class="card-address">📍 ${s.address}</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.innerHTML = `
      <div class="card-glow" style="background: ${catColors[s.cat]}"></div>
      <span class="card-badge badge-${s.cat}">${catEmoji[s.cat]} ${s.type}${detail}</span>
      <div class="card-name">${s.name}</div>
      <div class="card-meta">
        <span>📏 ${formatDist(dist)} away</span>
      </div>
      ${addrLine}
    `;

    const area     = document.getElementById('cardArea');
    const existing = area.querySelector('.suggestion-card');

    if (existing) {
      existing.classList.add('card-exit');
      setTimeout(() => {
        area.innerHTML = '';
        area.appendChild(card);
      }, 210);
    } else {
      area.innerHTML = '';
      area.appendChild(card);
    }

    const remaining = state.pool.length - state.index - 1;
    setButtons('browsing', remaining);
    updateSaveBtn(s.id);
    track('suggestion_viewed', { category: s.cat, position: state.index, remaining });
  } catch (err) {
    console.error('showSuggestion render error:', err); // eslint-disable-line no-console
    state.index++;
    if (state.index < state.pool.length) {
      showSuggestion();
    } else {
      showError(
        'Could not display any suggestions nearby. Try refreshing to search again.',
        'Try Again →',
        fetchSuggestions
      );
    }
  }
}

function setButtons(mode, remaining = 0) {
  const findBtn  = document.getElementById('findBtn');
  const saveBtn  = document.getElementById('saveBtn');
  const shareBtn = document.getElementById('shareBtn');
  const nahBtn   = document.getElementById('nahBtn');
  const counter  = document.getElementById('nearbyCount');

  findBtn.disabled = false;

  if (mode === 'loading') {
    findBtn.classList.add('hidden');
    saveBtn.classList.add('hidden');
    shareBtn.classList.add('hidden');
    nahBtn.classList.add('hidden');
    counter.classList.add('hidden');

  } else if (mode === 'error') {
    findBtn.textContent = 'Try Again ↻';
    findBtn.onclick = handleFindBtn;
    findBtn.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    shareBtn.classList.add('hidden');
    nahBtn.classList.add('hidden');
    counter.classList.add('hidden');

  } else if (mode === 'browsing') {
    findBtn.textContent = "Let's go →";
    findBtn.onclick = letsGo;
    findBtn.classList.remove('hidden');
    saveBtn.classList.remove('hidden');
    if (navigator.share || navigator.clipboard) shareBtn.classList.remove('hidden');
    nahBtn.textContent = 'Nah, what else →';
    nahBtn.onclick = nextSuggestion;
    nahBtn.classList.remove('hidden');
    counter.classList.remove('hidden');
    counter.textContent = remaining > 0 ? `${remaining} more nearby` : 'Last one nearby — will refresh';

  } else if (mode === 'confirming') {
    findBtn.textContent = 'Yes, take me there →';
    findBtn.onclick = confirmGo;
    findBtn.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    shareBtn.classList.add('hidden');
    nahBtn.textContent = 'Nah, go back';
    nahBtn.onclick = cancelGo;
    nahBtn.classList.remove('hidden');
    counter.classList.add('hidden');
  }
}

// ─────────────────────────────────────────────────────────
// USER ACTIONS
// ─────────────────────────────────────────────────────────
function handleFindBtn() {
  if (state.browsing && state.pool.length > 0) {
    showSuggestion(); // show current suggestion again (after error)
  } else {
    fetchSuggestions();
  }
}

function nextSuggestion() {
  const current = state.pool[state.index];
  if (current) {
    state.seenIds.add(current.id);
    track('place_skipped', { category: current.cat, position: state.index });
  }
  state.index++;
  showSuggestion();
}

function letsGo() {
  const s = state.pool[state.index];
  if (!s) return;
  track('lets_go_tapped', { category: s.cat, position: state.index });
  setButtons('confirming');
}

function confirmGo() {
  const s = state.pool[state.index];
  if (!s) return;
  track('navigation_opened', { category: s.cat, position: state.index });
  const url = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const win = window.open(url, '_blank');
  if (!win) {
    showError(
      'Your browser blocked the map from opening. Allow pop-ups for this site, then try again.',
      'Try Again →',
      confirmGo
    );
  }
}

function cancelGo() {
  showSuggestion();
}

function sharePlace() {
  const s = state.pool[state.index];
  if (!s) return;

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' ' + s.lat + ',' + s.lon)}`;
  const dist    = haversineMeters(state.lat, state.lon, s.lat, s.lon);
  const text    = `${s.name} — ${s.type}, ${formatDist(dist)} away`;

  const shareMethod = navigator.share ? 'native' : 'clipboard';
  track('place_shared', { category: s.cat, method: shareMethod });

  if (navigator.share) {
    navigator.share({ title: s.name, text, url: mapsUrl }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(`${text}\n${mapsUrl}`).then(() => {
      const btn = document.getElementById('shareBtn');
      const prev = btn.innerHTML;
      btn.innerHTML = '✓';
      setTimeout(() => { btn.innerHTML = prev; }, 1500);
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────
// SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────
// EVENT LISTENERS (replaces inline onclick attributes)
// ─────────────────────────────────────────────────────────
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => toggleCategory(btn.dataset.cat));
});
document.getElementById('openNowBtn').addEventListener('click', toggleOpenNow);
document.getElementById('profileBtn').addEventListener('click', openPlacesPanel);
document.getElementById('findBtn').addEventListener('click', handleFindBtn);
document.getElementById('saveBtn').addEventListener('click', toggleSavePlace);
document.getElementById('shareBtn').addEventListener('click', sharePlace);
document.getElementById('nahBtn').addEventListener('click', nextSuggestion);
document.getElementById('drawerOverlay').addEventListener('click', closePlacesPanel);
document.querySelector('.btn-drawer-close').addEventListener('click', closePlacesPanel);

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
track('app_loaded');
updateProfileBtnBadge();
initLocation();
