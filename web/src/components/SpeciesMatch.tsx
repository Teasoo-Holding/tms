import { SPECIES_CHECK_TERMS } from '../glossary';

/** Filter options for the species check's traffic light (#103). */
export const SPECIES_MATCH_FILTERS: [string, string][] = [
  ['red', 'Species match: red'],
  ['amber', 'Species match: amber'],
  ['green', 'Species match: green'],
  ['changed', 'Species changed since check'],
  ['unchecked', 'Species not checked'],
];

const TITLE: Record<string, string> = {
  green: 'Pl@ntNet agrees with the officer’s species',
  amber: 'Pl@ntNet is unsure',
  red: 'Pl@ntNet clearly suggests another species: review it on the Species check page',
  changed: 'The species was changed after the photo was checked',
};

/**
 * Pl@ntNet's likelihood that the officer's species is right, as a percentage, coloured green (agrees or confirmed by
 * an administrator), amber (unsure) or red (clearly another species).
 */
export function SpeciesMatch({ match, score, review }: { match?: string | null; score?: number | null; review?: string | null }) {
  if (!match || match === 'unchecked') return <span className="muted" title="This tree’s photo has not been checked">—</span>;
  if (review === 'KEPT' || review === 'CORRECTED') {
    return (
      <span className="species-match green" title={review === 'KEPT' ? 'An administrator confirmed the officer’s species' : 'An administrator corrected the species'}>
        <span className="dot" aria-hidden />
        {review === 'KEPT' ? 'Confirmed' : 'Corrected'}
      </span>
    );
  }
  if (match === 'changed') return <span className="muted" title={TITLE.changed}>Changed</span>;
  const label = { green: 'likely right', amber: 'unsure', red: 'likely wrong' }[match] ?? '';
  return (
    <span className={`species-match ${match}`} title={`${TITLE[match]}. ${SPECIES_CHECK_TERMS.check.definition}`}>
      <span className="dot" aria-hidden />
      {score == null ? '—' : `${Math.round(score * 100)}%`}
      <span className="visually-hidden"> ({label})</span>
    </span>
  );
}
