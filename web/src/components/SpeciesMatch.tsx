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
  green: 'Green: Pl@ntNet gives the officer’s species 60% or more',
  amber: 'Amber: Pl@ntNet gives the officer’s species 25–59%',
  red: 'Red: Pl@ntNet gives the officer’s species under 25%',
  changed: 'The species was changed after the photo was checked',
};

/**
 * Pl@ntNet's likelihood that the officer's species is right, as a percentage: green at 60% or more (or confirmed by
 * an administrator), amber from 25%, red below. The colours are set on the server (SPECIES_MATCH_SQL).
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
  const label = { green: 'likely right', amber: 'possible', red: 'unlikely' }[match] ?? '';
  return (
    <span className={`species-match ${match}`} title={`${TITLE[match]}. ${SPECIES_CHECK_TERMS.check.definition}`}>
      <span className="dot" aria-hidden />
      {score == null ? '—' : `${Math.round(score * 100)}%`}
      <span className="visually-hidden"> ({label})</span>
    </span>
  );
}
