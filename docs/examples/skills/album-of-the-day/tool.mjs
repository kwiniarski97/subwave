// Album of the day: choose one library album for this airing, research it, and
// hand the controller the album to walk in album order.
//
// Selection: Navidrome's random album sample, then hard filters, then the
// station's model chooses among the survivors (a random survivor if it cannot).
// If nothing survives two draws, any random album, unfiltered, so the show
// always has a record. available:false only when Navidrome itself is down.

export const configFields = {
	maxAlbumMinutes: { type: 'number', label: 'Longest album (minutes)', min: 10, max: 600, integer: true, hint: 'Keep it inside the show slot; an album that runs past the show end is cut there. Default 110.' },
	minTracks: { type: 'number', label: 'Fewest tracks', min: 1, max: 100, integer: true, hint: 'Default 5.' },
	noRepeatDays: { type: 'number', label: 'Days before an album may return', min: 0, max: 3650, integer: true, hint: '0 allows repeats. Default 90.' },
	recentPlayHours: { type: 'number', label: 'Skip albums with a song played in the last (hours)', min: 0, max: 720, integer: true, hint: '0 turns this off. Default 24.' },
	shortlist: { type: 'number', label: 'Albums offered to the model', min: 1, max: 20, integer: true, hint: 'Default 8.' },
};

const DEFAULTS = { maxAlbumMinutes: 110, minTracks: 5, noRepeatDays: 90, recentPlayHours: 24, shortlist: 8 };
const DRAW = 20;

// The whole preparation must finish inside the controller's 30 s budget, and
// research is optional, so a slow search provider gives up here rather than
// failing the airing's album with it. Selection (one model call) runs first,
// so research gets what is left with room to spare. A meta-search engine such
// as SearXNG routinely needs more than 6 s, which left research empty.
// Exported so a test can shorten it.
export const timing = { researchMs: 12000 };

// Wikipedia is asked directly, beside the search provider: a search snippet is
// 300 characters, an article lead is the record's actual history. Swappable so
// a test never reaches the network.
export const net = { fetch: (url, init) => fetch(url, init) };
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia refuses an anonymous client, so the request names itself.
const wikiInit = () => ({ headers: { 'User-Agent': 'SUB-WAVE radio album-of-the-day skill (https://github.com/perminder-klair/subwave)' }, signal: AbortSignal.timeout(timing.researchMs) });

// A field left blank arrives as '' (or not at all), and Number('') is 0, so a
// blank would silently mean "no limit". Blank means the default.
function setting(config, key) {
	const raw = config?.[key];
	if (raw === undefined || raw === null || raw === '') return DEFAULTS[key];
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : DEFAULTS[key];
}

const byAlbumOrder = (a, b) => ((Number(a.discNumber) || 1) - (Number(b.discNumber) || 1))
	|| ((Number(a.track) || Number.MAX_SAFE_INTEGER) - (Number(b.track) || Number.MAX_SAFE_INTEGER));

async function shortlistFrom(services, drawn, limits, featured, played, ctx) {
	const passing = drawn.filter(a => a.songCount >= limits.minTracks
		&& a.duration > 0 && a.duration <= limits.maxAlbumMinutes * 60
		&& !a.isCompilation && !featured.has(a.id));
	// These checks need each album's songs, so they only run on as many albums
	// as the shortlist can use. albumPlayable applies the show's own rules
	// (blocklist, strict locks, playlists, length limits), so the controller
	// never refuses the album this skill hands it.
	const checked = await Promise.all(passing.slice(0, limits.shortlist).map(async a => {
		try {
			if (!(await services.library.albumPlayable(a.id, { at: ctx?.at }))) return null;
			if (!played.size) return a;
			const songs = await services.library.getAlbum(a.id);
			return songs.some(s => played.has(s.id)) ? null : a;
		} catch {
			return null;
		}
	}));
	return checked.filter(Boolean);
}

async function chooseOne(services, shortlist, ctx) {
	if (shortlist.length === 1) return shortlist[0];
	const topic = String(ctx?.activeShow?.topic || ctx?.activeShow?.name || '').slice(0, 300);
	const index = await services.choose({
		prompt: `Choose the album that would make the best album-of-the-day feature${topic ? ` for this show (${topic})` : ''}: one with a story worth telling between its songs.`,
		options: shortlist.map(a => `${a.name} — ${a.artist}${a.year ? ` (${a.year})` : ''}${a.genre ? `, ${a.genre}` : ''}`),
	});
	return Number.isInteger(index) && shortlist[index] ? shortlist[index] : shortlist[Math.floor(Math.random() * shortlist.length)];
}

async function filteredPick(services, limits, ctx) {
	const featured = await services.featured.recentAlbumIds(limits.noRepeatDays);
	const played = limits.recentPlayHours > 0 ? services.recentPlays(limits.recentPlayHours).ids : new Set();
	for (let page = 0; page < 2; page++) {
		const shortlist = await shortlistFrom(services, await services.library.randomAlbums({ count: DRAW }), limits, featured, played, ctx);
		if (shortlist.length) return chooseOne(services, shortlist, ctx);
	}
	return null;
}

// What a music server appends to a release title: "(Remastered Deluxe
// Edition)", "[2011 Remaster]". Pages about the record use the plain title,
// so searching or filtering on the edition's name finds nothing but shop
// listings that happen to repeat it.
const EDITION_MARK = /\b(remaster(ed)?|deluxe|edition|anniversary|expanded|reissue(d)?|bonus|mono|stereo|version|special|collector'?s?)\b/i;

export function baseTitle(name) {
	let title = String(name || '').trim();
	for (;;) {
		const m = title.match(/\s*[([]([^()[\]]*)[)\]]\s*$/);
		if (!m || !EDITION_MARK.test(m[1])) break;
		title = title.slice(0, m.index).trim();
	}
	return title || String(name || '').trim();
}

export const isEdition = name => baseTitle(name) !== String(name || '').trim();

const fold = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

// A page counts when it names both the record and the artist, and its own
// title names one of them. The snippet alone is not enough: a shop page for
// another band's album lists this one, artist and all, under "related albums".
function aboutAlbum(row, album) {
	const title = fold(baseTitle(album.name));
	const artist = fold(album.artist);
	const heading = fold(row.title);
	const text = `${heading} ${fold(row.content)}`;
	return text.includes(title) && text.includes(artist) && (heading.includes(title) || heading.includes(artist));
}

async function searchResearch(services, album) {
	if (!services.searchReady()) return [];
	const title = baseTitle(album.name);
	const queries = [`${album.artist} "${title}" album`, `${album.artist} ${title} album review`];
	const answers = await Promise.allSettled(queries.map(q => services.searchWeb(q)));
	const seen = new Set();
	const rows = [];
	for (const answer of answers) {
		if (answer.status !== 'fulfilled') continue;
		for (const row of answer.value?.results || []) {
			const key = String(row.url || row.title || '');
			if (seen.has(key) || !aboutAlbum(row, album)) continue;
			seen.add(key);
			rows.push({ title: String(row.title || '').slice(0, 200), url: String(row.url || ''), content: String(row.content || '').slice(0, 700) });
		}
	}
	return rows;
}

async function wikipediaResearch(album) {
	try {
		const title = baseTitle(album.name);
		const search = new URL(WIKIPEDIA_API);
		for (const [k, v] of Object.entries({ action: 'query', list: 'search', srsearch: `${album.artist} ${title} album`, srlimit: '3', format: 'json' })) search.searchParams.set(k, v);
		const hits = (await (await net.fetch(search, wikiInit())).json())?.query?.search || [];
		const hit = hits.find(h => fold(h.title).includes(fold(title)));
		if (!hit) return [];
		const page = new URL(WIKIPEDIA_API);
		for (const [k, v] of Object.entries({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', redirects: '1', titles: hit.title, format: 'json' })) page.searchParams.set(k, v);
		const pages = (await (await net.fetch(page, wikiInit())).json())?.query?.pages || {};
		const extract = String(Object.values(pages)[0]?.extract || '').trim();
		if (!extract || !fold(extract).includes(fold(album.artist))) return [];
		return [{ title: `${hit.title} (Wikipedia)`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`, content: extract.slice(0, 1500) }];
	} catch {
		return [];
	}
}

async function research(services, album) {
	try {
		const [wiki, web] = await Promise.all([wikipediaResearch(album), searchResearch(services, album).catch(() => [])]);
		return [...wiki, ...web].slice(0, 5);
	} catch {
		// The album still airs without research. The DJ sticks to library facts.
		return [];
	}
}

function withinBudget(work, ms, fallback) {
	let timer;
	const late = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export default async function prepareAlbumOfTheDay(ctx, state, services, config, input) {
	const limits = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, setting(config, key)]));
	let album = null;
	try {
		album = await filteredPick(services, limits, ctx);
	} catch (error) {
		services.log(`album-of-the-day: filtered pick failed (${error?.message || error}); taking any album`);
	}
	if (!album) {
		try {
			[album] = await services.library.randomAlbums({ count: 1 });
		} catch (error) {
			return { available: false, reason: `Navidrome is unreachable: ${error?.message || error}` };
		}
		if (!album) return { available: false, reason: 'Navidrome returned no albums.' };
	}
	const [songs, found] = await Promise.all([
		services.library.getAlbum(album.id).then(list => list.slice().sort(byAlbumOrder)).catch(() => []), // the controller resolves the album again
		withinBudget(research(services, album), timing.researchMs, []),
	]);
	// A reissue's tag dates the reissue, not the record, so it is labelled as
	// such: "a 2020 album" aired for a record first released in 2000.
	const dated = isEdition(album.name) ? { editionYear: album.year } : { year: album.year };
	return {
		available: true,
		subject: `${album.name} by ${album.artist}`.slice(0, 160),
		data: {
			album: { name: album.name, artist: album.artist, ...dated, genre: album.genre },
			// No running times: a DJ handed them reads them out.
			tracklist: songs.slice(0, 60).map((song, i) => ({ position: i + 1, title: String(song.title || '').slice(0, 160) })),
			research: found,
		},
		music: { type: 'album', albumId: album.id },
	};
}
