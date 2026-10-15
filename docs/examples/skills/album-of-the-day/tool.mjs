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

async function shortlistFrom(services, drawn, limits, featured, played) {
	const passing = drawn.filter(a => a.songCount >= limits.minTracks
		&& a.duration > 0 && a.duration <= limits.maxAlbumMinutes * 60
		&& !a.isCompilation && !featured.has(a.id));
	// The recent-play check needs each album's songs, so it only runs on as
	// many albums as the shortlist can use.
	const checked = await Promise.all(passing.slice(0, limits.shortlist).map(async a => {
		if (!played.size) return a;
		try {
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
		const shortlist = await shortlistFrom(services, await services.library.randomAlbums({ count: DRAW }), limits, featured, played);
		if (shortlist.length) return chooseOne(services, shortlist, ctx);
	}
	return null;
}

async function research(services, album) {
	if (!services.searchReady()) return [];
	try {
		const found = await services.searchWeb(`"${album.artist}" "${album.name}" album recording history`);
		const needle = album.name.toLowerCase();
		return (found?.results || [])
			.filter(row => `${row.title || ''} ${row.content || ''}`.toLowerCase().includes(needle))
			.slice(0, 4)
			.map(row => ({ title: String(row.title || '').slice(0, 200), url: String(row.url || ''), content: String(row.content || '').slice(0, 700) }));
	} catch {
		// The album still airs without research. The DJ sticks to library facts.
		return [];
	}
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
	let songs = [];
	try { songs = (await services.library.getAlbum(album.id)).slice().sort(byAlbumOrder); } catch { /* the controller resolves the album again */ }
	return {
		available: true,
		subject: `${album.name} by ${album.artist}`.slice(0, 160),
		data: {
			album: { name: album.name, artist: album.artist, year: album.year, genre: album.genre },
			tracklist: songs.slice(0, 60).map((song, i) => ({ position: i + 1, title: String(song.title || '').slice(0, 160), durationSec: Number(song.duration) || null })),
			research: await research(services, album),
		},
		music: { type: 'album', albumId: album.id },
	};
}
