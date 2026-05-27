'use strict';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const FALLBACK_POSTER = 'https://via.placeholder.com/500x750/0f172a/e2e8f0?text=No+Poster';

const state = {
  suggestions: safeArray(window.suggestions),
  castDetails: window.castDetails || {},
  tmdbKey: window.TMDB_API_KEY || 'f8c7a842dd3a11ff444ffd2d20659eb0'
};

document.addEventListener('DOMContentLoaded', () => {
  hydrateTheme();
  hydrateComputedLabels();
  hydrateRatingGauges();
  bindSearch();
  bindSuggestions();
  bindCastModal();
  bindReviewModal();
  bindRecommendationCards();
});

function safeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function hydrateTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const label = document.getElementById('theme-label');
  const icon = document.getElementById('theme-icon');
  const savedTheme = localStorage.getItem('movie-recommender-theme') || 'dark';

  applyTheme(savedTheme);
  toggle?.addEventListener('click', () => {
    const nextTheme = root.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem('movie-recommender-theme', nextTheme);
    applyTheme(nextTheme);
  });

  function applyTheme(theme) {
    const isDark = theme !== 'light';
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);
    toggle?.setAttribute('aria-pressed', String(isDark));
    if (label) label.textContent = isDark ? 'Dark' : 'Light';
    if (icon) icon.textContent = isDark ? '☾' : '☀';
  }
}

function hydrateComputedLabels() {
  document.querySelectorAll('[data-runtime-label]').forEach((node) => {
    const total = Number.parseInt(node.dataset.runtimeLabel, 10);
    if (!Number.isNaN(total)) node.textContent = formatRuntime(total);
  });

  document.querySelectorAll('[data-release-label]').forEach((node) => {
    node.textContent = formatDate(node.dataset.releaseLabel);
  });

  document.querySelectorAll('[data-release-date]').forEach((node) => {
    node.textContent = formatDate(node.dataset.releaseDate);
  });

  document.querySelectorAll('[data-runtime]').forEach((node) => {
    const total = Number.parseInt(node.dataset.runtime, 10);
    if (!Number.isNaN(total)) node.textContent = formatRuntime(total);
  });
}

function hydrateRatingGauges() {
  document.querySelectorAll('[data-rating]').forEach((node) => {
    const rating = Math.max(0, Math.min(10, Number.parseFloat(node.dataset.rating) || 0));
    const degrees = Math.round((rating / 10) * 360);
    node.style.background = `conic-gradient(rgb(34 211 238) ${degrees}deg, rgba(148, 163, 184, .22) ${degrees}deg)`;
  });
}

function bindSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('movie-search');
  const loading = document.getElementById('loading-panel');
  const panel = document.getElementById('suggestion-panel');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const movieName = input?.value.trim();
    if (!movieName) return;

    hideSuggestionPanel(panel);
    setLoading(true);
    try {
      const recommendationGroups = await fetchSimilarMovies(movieName);
      const allRecommendationNames = uniqueTitles([
        ...recommendationGroups.actor,
        ...recommendationGroups.director,
        ...recommendationGroups.genre
      ]);
      if (!allRecommendationNames.length) throw new Error('No recommendations were returned.');

      const movie = await fetchMovieDetails(movieName);
      const [credits, reviews, recommendationDetails] = await Promise.all([
        fetchCredits(movie.id),
        fetchMovieReviews(movie.id),
        fetchMovieDetailsMap(allRecommendationNames)
      ]);

      const cast = credits.cast.slice(0, 10);
      const castDetails = await Promise.all(cast.map((member) => fetchPersonDetails(member.id)));
      const payload = buildRecommendationPayload(movie, cast, castDetails, recommendationGroups, recommendationDetails, reviews);
      submitForm('/recommend', payload);
    } catch (error) {
      alert(error.message || 'Unable to load movie recommendations.');
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    loading?.classList.toggle('hidden', !isLoading);
    loading?.classList.toggle('block', isLoading);
  }
}

function bindSuggestions() {
  const input = document.getElementById('movie-search');
  const panel = document.getElementById('suggestion-panel');
  const form = document.getElementById('search-form');
  if (!input || !panel) return;

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      hideSuggestionPanel(panel);
      return;
    }

    const matches = state.suggestions
      .filter((title) => title.toLowerCase().includes(query))
      .slice(0, 8);

    if (!matches.length) {
      hideSuggestionPanel(panel);
      return;
    }

    panel.innerHTML = matches
      .map((title) => `
        <button type="button" class="suggestion-option block w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition hover:bg-cyan-400/15 focus:bg-cyan-400/15 focus:outline-none" data-title="${escapeAttribute(title)}">
          ${escapeHtml(title)}
        </button>`)
      .join('');
    panel.hidden = false;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideSuggestionPanel(panel);
    if (event.key === 'ArrowDown' && !panel.hidden) {
      event.preventDefault();
      panel.querySelector('.suggestion-option')?.focus();
    }
  });

  panel.addEventListener('keydown', (event) => {
    const options = Array.from(panel.querySelectorAll('.suggestion-option'));
    const index = options.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      input.focus();
      hideSuggestionPanel(panel);
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[Math.min(index + 1, options.length - 1)]?.focus();
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0) input.focus();
      else options[index - 1]?.focus();
    }
  });

  panel.addEventListener('click', (event) => {
    const option = event.target.closest('.suggestion-option');
    if (!option) return;
    input.value = option.dataset.title || '';
    hideSuggestionPanel(panel);
    form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });

  document.addEventListener('click', (event) => {
    if (!form?.contains(event.target)) hideSuggestionPanel(panel);
  });
}

function hideSuggestionPanel(panel) {
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }
}

function bindCastModal() {
  const modal = document.getElementById('cast-modal');
  const body = document.getElementById('cast-modal-body');
  const close = document.getElementById('cast-modal-close');

  document.addEventListener('click', async (event) => {
      const card = event.target.closest('.cast-card');
      if (!card) return;

      const name = card.dataset.castName;
      let details = state.castDetails[name];
      if (!body || !modal) return;

      if (!details && card.dataset.castId) {
        try {
          const person = await fetchPersonDetails(card.dataset.castId);
          details = [
            person.id,
            imageUrl(person.profile_path),
            person.birthday || 'Unknown',
            person.place_of_birth || 'Unknown',
            person.biography || 'Biography unavailable.'
          ];
          state.castDetails[name] = details;
        } catch {
          details = [card.dataset.castId, FALLBACK_POSTER, 'Unknown', 'Unknown', 'Biography unavailable.'];
        }
      }

      if (!details) return;

      const [id, profile, birthday, place, biography] = details;
      body.innerHTML = `
        <img src="${escapeAttribute(profile || FALLBACK_POSTER)}" alt="${escapeAttribute(name)}" class="w-full rounded-lg object-cover">
        <div>
          <p class="mb-2 text-sm font-bold uppercase tracking-[.2em] text-cyan-300">TMDB #${escapeHtml(id || '')}</p>
          <h3 class="text-3xl font-black">${escapeHtml(name)}</h3>
          <dl class="mt-5 grid gap-3 text-sm">
            <div><dt class="font-bold text-slate-400">Born</dt><dd>${escapeHtml(birthday || 'Unknown')}</dd></div>
            <div><dt class="font-bold text-slate-400">Birthplace</dt><dd>${escapeHtml(place || 'Unknown')}</dd></div>
          </dl>
          <h4 class="mt-6 text-sm font-black uppercase tracking-[.2em] text-slate-500 dark:text-slate-400">Biography</h4>
          <p class="mt-3 whitespace-pre-line leading-7 text-slate-700 dark:text-slate-300">${escapeHtml(biography || 'Biography unavailable.')}</p>
        </div>`;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      close?.focus();
  });

  close?.addEventListener('click', hideModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) hideModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideModal();
  });

  function hideModal() {
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
  }
}

function bindReviewModal() {
  const modal = document.getElementById('review-modal');
  const body = document.getElementById('review-modal-body');
  const status = document.getElementById('review-modal-status');
  const close = document.getElementById('review-modal-close');

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.review-card');
    if (!card || !modal || !body || !status) return;

    const reviewStatus = card.dataset.status || 'Unknown';
    body.textContent = card.dataset.review || '';
    status.textContent = statusLabel(reviewStatus);
    status.className = `mb-1 inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass(reviewStatus)}`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    close?.focus();
  });

  close?.addEventListener('click', hideModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) hideModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideModal();
  });

  function hideModal() {
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
  }
}

function bindRecommendationCards() {
  document.addEventListener('click', (event) => {
    const card = event.target.closest('.recommendation-card');
    if (!card) return;

    const input = document.getElementById('movie-search');
    const form = document.getElementById('search-form');
    if (input) input.value = card.dataset.movie || '';
    form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function fetchSimilarMovies(movieName) {
  const body = new URLSearchParams({ name: movieName });
  const response = await fetch('/similarity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || 'No recommendations were returned.');

  return {
    actor: safeArray(payload.actor),
    director: safeArray(payload.director),
    genre: safeArray(payload.genre)
  };
}

async function fetchMovieDetails(movieName) {
  assertTmdbKey();
  const searchUrl = new URL('https://api.themoviedb.org/3/search/movie');
  searchUrl.search = new URLSearchParams({ api_key: state.tmdbKey, query: movieName }).toString();
  const searchData = await fetchJson(searchUrl);
  const result = searchData.results?.[0];
  if (!result) throw new Error(`No TMDB match found for "${movieName}".`);

  const detailUrl = new URL(`https://api.themoviedb.org/3/movie/${result.id}`);
  detailUrl.search = new URLSearchParams({ api_key: state.tmdbKey }).toString();
  return fetchJson(detailUrl);
}

async function fetchMovieDetailsMap(movieNames) {
  const entries = await Promise.all(movieNames.map(async (name) => {
    try {
      return [name, await fetchMovieDetails(name)];
    } catch {
      return [name, null];
    }
  }));

  return Object.fromEntries(entries.filter(([, details]) => details));
}

async function fetchCredits(movieId) {
  assertTmdbKey();
  const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}/credits`);
  url.search = new URLSearchParams({ api_key: state.tmdbKey }).toString();
  return fetchJson(url);
}

async function fetchPersonDetails(personId) {
  assertTmdbKey();
  const url = new URL(`https://api.themoviedb.org/3/person/${personId}`);
  url.search = new URLSearchParams({ api_key: state.tmdbKey }).toString();
  return fetchJson(url);
}

async function fetchMovieReviews(movieId) {
  assertTmdbKey();
  const pages = [1, 2];
  const reviewPages = await Promise.all(pages.map((page) => {
    const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}/reviews`);
    url.search = new URLSearchParams({ api_key: state.tmdbKey, language: 'en-US', page: String(page) }).toString();
    return fetchJson(url);
  }));

  return reviewPages
    .flatMap((data) => data.results || [])
    .map((review) => review.content)
    .filter(Boolean)
    .slice(0, 24);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function postForm(url, body, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    redirect: options.redirect === false ? 'manual' : 'follow'
  });
  if (!response.ok && response.type !== 'opaqueredirect') throw new Error(`Request failed: ${response.status}`);

  return response.text();
}

function submitForm(url, body) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.hidden = true;

  for (const [key, value] of body.entries()) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

function buildRecommendationPayload(movie, cast, castDetails, recGroups, recDetailsByName, reviews = []) {
  const poster = imageUrl(movie.poster_path);
  const genres = (movie.genres || []).map((genre) => genre.name).join(', ');
  const imdbId = movie.imdb_id || '';
  const fallbackNames = uniqueTitles([...recGroups.actor, ...recGroups.director, ...recGroups.genre]).slice(0, 10);
  const fallbackPosters = postersFor(fallbackNames, recDetailsByName);

  return new URLSearchParams({
    title: movie.title || movie.original_title || '',
    cast_ids: JSON.stringify(cast.map((member) => member.id)),
    cast_names: JSON.stringify(cast.map((member) => member.name || 'Unknown')),
    cast_chars: JSON.stringify(cast.map((member) => member.character || 'Unknown role')),
    cast_bdays: JSON.stringify(castDetails.map((member) => member.birthday || 'Unknown')),
    cast_bios: JSON.stringify(castDetails.map((member) => member.biography || 'Biography unavailable.')),
    cast_places: JSON.stringify(castDetails.map((member) => member.place_of_birth || 'Unknown')),
    cast_profiles: JSON.stringify(cast.map((member, index) => imageUrl(member.profile_path || castDetails[index]?.profile_path))),
    imdb_id: imdbId,
    poster,
    genres,
    overview: movie.overview || 'Overview unavailable.',
    rating: String(movie.vote_average || 0),
    vote_count: String(movie.vote_count || 0),
    release_date: movie.release_date || '',
    runtime: String(movie.runtime || 0),
    status: movie.status || 'Released',
    rec_movies: JSON.stringify(fallbackNames),
    rec_posters: JSON.stringify(fallbackPosters),
    actor_rec_movies: JSON.stringify(recGroups.actor),
    actor_rec_posters: JSON.stringify(postersFor(recGroups.actor, recDetailsByName)),
    director_rec_movies: JSON.stringify(recGroups.director),
    director_rec_posters: JSON.stringify(postersFor(recGroups.director, recDetailsByName)),
    genre_rec_movies: JSON.stringify(recGroups.genre),
    genre_rec_posters: JSON.stringify(postersFor(recGroups.genre, recDetailsByName)),
    reviews: JSON.stringify(reviews)
  });
}

function uniqueTitles(titles) {
  const seen = new Set();
  return titles.filter((title) => {
    const key = String(title).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function postersFor(movieNames, detailsByName) {
  return movieNames.map((name) => imageUrl(detailsByName[name]?.poster_path));
}

function assertTmdbKey() {
  if (!state.tmdbKey) {
    throw new Error('TMDB API key is missing. Pass tmdb_api_key to the template or set window.TMDB_API_KEY.');
  }
}

function imageUrl(path) {
  return path ? `${TMDB_IMAGE_BASE}${path}` : FALLBACK_POSTER;
}

function formatRuntime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function statusLabel(status) {
  if (status === 'Good') return 'Good :)';
  if (status === 'Bad') return 'Bad :(';
  return 'Unavailable';
}

function statusClass(status) {
  if (status === 'Good') return 'theme-good';
  if (status === 'Bad') return 'theme-bad';
  return 'theme-muted theme-soft';
}
