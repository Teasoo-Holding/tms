import { DAY_NOTE } from './time';

/** One definition, used on the Dashboard tiles, the Glossary page and anywhere else the term appears. */
export interface Term {
  term: string;
  definition: string;
}

/** What the headline numbers count. `overdueDays` is the Dashboard's overdue period (90 by default). */
export function metricTerms(overdueDays = 90): Record<'planted' | 'alive' | 'dead' | 'noStatus' | 'notVisited' | 'overdue' | 'conflicts', Term> {
  return {
    planted: {
      term: 'Trees planted',
      definition:
        'Trees registered and accepted by the server, including replacement trees. Records still waiting on a phone and records the server rejected are not counted. With a date filter, trees registered in that period.',
    },
    alive: {
      term: 'Alive',
      definition: "Trees whose status at their latest visit is not a terminal status (such as dead or missing).",
    },
    dead: {
      term: 'Dead or missing',
      definition: 'Trees whose status at their latest visit is marked terminal (for example Dead or Missing). Only accepted records count.',
    },
    noStatus: {
      term: 'No status yet',
      definition: 'Registered trees with no alive or dead status recorded yet. They are left out of the alive share.',
    },
    notVisited: {
      term: 'Not yet visited',
      definition: 'Registered trees with no follow-up visit since they were registered.',
    },
    overdue: {
      term: 'Overdue',
      definition: `Living trees with no visit in the last ${overdueDays} days, counted from the latest visit or, for a tree never visited, from its registration. Dead or missing trees are not counted. Maintenance due dates are a separate alert.`,
    },
    conflicts: {
      term: 'Open conflicts',
      definition: 'Duplicate tree IDs reported by phones that an administrator has not resolved yet.',
    },
  };
}

/** Words used across the pages. */
export const RECORD_TERMS: Term[] = [
  { term: 'Registered', definition: 'The first record of a new tree: its tag, species, area and first status.' },
  { term: 'Visit', definition: 'A follow-up record of a tree that is already registered.' },
  { term: 'Correction', definition: 'A change to an earlier visit. The original record is kept, marked as replaced, and corrections are counted apart from visits.' },
  { term: 'Rejected', definition: 'A record the server refused, for example a duplicate tag or a missing vendor. Rejected records are not counted anywhere.' },
  { term: 'Replacement tree', definition: 'A tree planted in place of a dead or missing one. It is counted in Trees planted and shown separately.' },
  { term: 'Field session', definition: 'One officer’s stretch of field work on a phone, from Start field session to End session.' },
  { term: 'Days and times', definition: `All dates and times are West Africa Time (WAT, Africa/Lagos). ${DAY_NOTE}` },
];

export const glossary = (overdueDays = 90): Term[] => [...Object.values(metricTerms(overdueDays)), ...RECORD_TERMS];
