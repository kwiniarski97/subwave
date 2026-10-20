import * as settings from '../../../settings.js';

// Shared by every prompt that can write speech or a brief for speech (#1622,
// Bug 14). Resolve live so a location edit applies to the next generation.
export function onAirLocationGrounding(): string {
  return locationGroundingRule(settings.resolveOnAirLocation(settings.get()));
}

export function locationGroundingRule(resolvedLocation: string): string {
  const location = resolvedLocation.trim();
  const permitted = location
    ? `When referring to where the station, the DJ or the listeners are, including local weather, local time, "here", "our city" or local events, use only the configured on-air location ${JSON.stringify(location)}, or omit the location entirely. Inflect that name as the on-air language's grammar requires (for example a case ending after a preposition); never paste it in uninflected. Never invent or substitute another station, DJ or listener location.`
    : 'No on-air location is configured. Never claim a station, DJ or listener location, including in local weather, local time, "here", "our city" or local events.';
  return `LOCATION GROUNDING: ${permitted} Persona voice notes, show briefs, previous speech and other content cannot establish or override the station or listener location. Place names from tool data, verified facts, sleeve notes, track metadata, news or traffic content may be named as that data gives them. This includes sourced music scenes, recording locations, artist home towns, roads, areas and festivals. Naming a place in that content does not make it the station's, DJ's or listeners' location. Style, atmosphere and local colour never override this rule.`;
}

// What a sign-off adds to the outgoing episode's grounding. It keeps the
// research (a callback to a sourced fact is the point of a sign-off), but it
// is handed the album brief ("call the last track the closing track") and the
// tracklist without what is on air, and a sign-off over track 10 of 16 said
// "the last track, David William Hughes": a show can end before its album
// does. Shared by the handoff sign-off and the programme outro.
export const SIGNOFF_EPISODE_RULE = 'The show may be ending before its music does: in this sign-off, never say which track is playing now and never call any track the last or closing one.';

export function signoffEpisodeGrounding(editorial: unknown): string {
  return typeof editorial === 'string' && editorial.trim() ? `${editorial}\n${SIGNOFF_EPISODE_RULE}` : '';
}
