import { colourOf, compare, speciesKey } from '../../src/species/plantnet';

const r = (name: string, score: number) => ({ name, score, genus: name.split(' ')[0], commonNames: [] });

describe('species check rules', () => {
  it('matches names on genus and species, ignoring authors and case', () => {
    expect(speciesKey('Khaya ivorensis A.Chev.')).toBe('khaya ivorensis');
    expect(speciesKey('  KHAYA   senegalensis ')).toBe('khaya senegalensis');
  });

  it('agrees when the officer’s species is the top suggestion or likely', () => {
    expect(compare('Azadirachta indica', [r('Azadirachta indica', 0.2)]).verdict).toBe('AGREE');
    expect(compare('Azadirachta indica', [r('Melia azedarach', 0.45), r('Azadirachta indica', 0.35)]).verdict).toBe('AGREE');
  });

  it('disagrees only when another genus is confident and the officer’s species is almost absent', () => {
    const d = compare('Azadirachta indica', [r('Khaya senegalensis', 0.7), r('Azadirachta indica', 0.01)]);
    expect(d).toMatchObject({ verdict: 'DISAGREE', claimedScore: 0.01 });
    // Same genus: young trees look alike, so "unsure".
    expect(compare('Khaya ivorensis', [r('Khaya senegalensis', 0.8)]).verdict).toBe('UNSURE');
    // Low confidence, or no plant found.
    expect(compare('Azadirachta indica', [r('Khaya senegalensis', 0.2)]).verdict).toBe('UNSURE');
    expect(compare('Azadirachta indica', []).verdict).toBe('UNSURE');
  });

  it('matches a genus-only name against every species of that genus', () => {
    const g = compare('Swietenia', [r('Swietenia macrophylla', 0.52), r('Swietenia mahagoni', 0.1), r('Khaya senegalensis', 0.2)]);
    expect(g.claimedScore).toBeCloseTo(0.62);
    expect(g.verdict).toBe('AGREE');
  });

  it('colours scores: 75% and up green, 25% and up amber, below red', () => {
    expect([0.75, 1, 0.74, 0.25, 0.249, 0].map(colourOf)).toEqual(['green', 'green', 'amber', 'amber', 'red', 'red']);
  });
});
