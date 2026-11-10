/** One Pl@ntNet suggestion. */
export interface PlantNetResult {
  score: number;
  /** "Khaya ivorensis", without the author. */
  name: string;
  genus: string;
  commonNames: string[];
}

export class PlantNetQuotaError extends Error {}

const ENDPOINT = 'https://my-api.plantnet.org/v2/identify/all';

/**
 * Asks Pl@ntNet which species a photo shows. The API key goes in the query string, so the URL is never logged
 * or put into an error message.
 */
export async function identify(apiKey: string, photo: Buffer, mimeType = 'image/jpeg'): Promise<{ results: PlantNetResult[]; remaining: number | null }> {
  const form = new FormData();
  form.append('images', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo.jpg');
  form.append('organs', 'auto');
  const params = new URLSearchParams({ 'api-key': apiKey, 'include-related-images': 'false', 'no-reject': 'true', 'nb-results': '10', lang: 'en' });
  const res = await fetch(`${ENDPOINT}?${params}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  if (res.status === 429) throw new PlantNetQuotaError('Pl@ntNet daily quota reached');
  // 404 means Pl@ntNet found no plant in the photo.
  if (res.status === 404) return { results: [], remaining: null };
  if (!res.ok) throw new Error(`Pl@ntNet answered HTTP ${res.status}`);
  const body: any = await res.json();
  const results: PlantNetResult[] = (body.results ?? []).map((r: any) => ({
    score: Number(r.score) || 0,
    name: String(r.species?.scientificNameWithoutAuthor ?? ''),
    genus: String(r.species?.genus?.scientificNameWithoutAuthor ?? ''),
    commonNames: Array.isArray(r.species?.commonNames) ? r.species.commonNames.slice(0, 3).map(String) : [],
  }));
  return { results, remaining: typeof body.remainingIdentificationRequests === 'number' ? body.remainingIdentificationRequests : null };
}

/** "Khaya ivorensis A.Chev." → "khaya ivorensis": genus and species epithet, for matching names. */
export function speciesKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().split(/\s+/).filter((w) => w !== '×' && w !== 'x').slice(0, 2).join(' ');
}
const genusOf = (name: string | null | undefined) => speciesKey(name).split(' ')[0] ?? '';

/** Colour bands for Pl@ntNet's score for the recorded species (#107): green 75–100%, amber 25–74%, red below. */
export const MATCH_GREEN = 0.75;
export const MATCH_AMBER = 0.25;
export type MatchColour = 'green' | 'amber' | 'red';
export const colourOf = (score: number): MatchColour => (score >= MATCH_GREEN ? 'green' : score >= MATCH_AMBER ? 'amber' : 'red');

/** A suggestion is confident above this score. */
export const CONFIDENT = 0.4;
/** The officer's species counts as likely at or above this score. */
export const LIKELY = 0.3;
/** Below this, Pl@ntNet sees no sign of the officer's species. */
export const UNLIKELY = 0.05;

/**
 * Compares Pl@ntNet's suggestions with the officer's species. Disagreement needs a confident top suggestion of
 * another genus and almost no score for the officer's species; same-genus suggestions stay "unsure", because young
 * trees of one genus look alike.
 */
export function compare(claimedName: string, results: PlantNetResult[]) {
  const claimed = speciesKey(claimedName);
  const top = results[0];
  // A genus-only name ("Swietenia") matches every species of that genus: their scores add up.
  const genusOnly = !!claimed && !claimed.includes(' ');
  const claimedScore = genusOnly
    ? Math.min(1, results.filter((r) => genusOf(r.name) === claimed).reduce((n, r) => n + r.score, 0))
    : results.find((r) => speciesKey(r.name) === claimed)?.score ?? 0;
  let verdict: 'AGREE' | 'DISAGREE' | 'UNSURE' = 'UNSURE';
  if (top && (speciesKey(top.name) === claimed || (genusOnly && genusOf(top.name) === claimed) || claimedScore >= LIKELY)) verdict = 'AGREE';
  else if (top && top.score >= CONFIDENT && claimedScore < UNLIKELY && genusOf(top.name) !== genusOf(claimedName)) verdict = 'DISAGREE';
  return { verdict, claimedScore, top };
}
