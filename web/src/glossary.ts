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

/** The species check (#101): Pl@ntNet's view of a sample of registration photos. */
export const SPECIES_CHECK_TERMS = {
  check: {
    term: 'Species check',
    definition: 'Each day, a random sample of up to 450 registration photos is sent to Pl@ntNet after they sync. Its suggestion is compared with the species the officer chose. It never changes a record by itself.',
  },
  agreement: {
    term: 'Agreement rate',
    definition: 'Of the photos where Pl@ntNet gave a clear answer, the share where it agrees with the officer’s species. Unsure results are left out.',
  },
  disagree: {
    term: 'Species to review',
    definition: 'Photos where Pl@ntNet is confident it is another genus and sees almost no sign of the officer’s species. An administrator keeps the officer’s species or corrects it.',
  },
  unsure: {
    term: 'Unsure',
    definition: 'Pl@ntNet was not confident, suggested a species of the same genus (young trees of one genus look alike), or found no plant in the photo.',
  },
} satisfies Record<string, Term>;

export const glossary = (overdueDays = 90): Term[] => [...Object.values(metricTerms(overdueDays)), ...RECORD_TERMS, ...Object.values(SPECIES_CHECK_TERMS)];
