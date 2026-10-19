import * as fs from 'fs';
import * as path from 'path';
import {
  assemblePhysicalId,
  IdScheme,
  normalizePhysicalId,
  normalizeSerial,
  serialScopeKey,
  TreeIdError,
  validateScheme,
} from '../../src/domain/tree-id';

const vectors = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../spec/tree-id-test-vectors.json'), 'utf8'));
const entities = vectors.entities;

describe('tree ID assembly (shared vectors)', () => {
  for (const v of vectors.assemble) {
    it(v.name, () => {
      const scheme: IdScheme = v.scheme;
      expect(validateScheme(scheme)).toEqual([]);
      expect(assemblePhysicalId(scheme, v.values, v.serialInput)).toEqual({
        prefix: v.expected.prefix,
        serial: v.expected.serial,
        physicalId: v.expected.physicalId,
        normalized: v.expected.normalized,
      });
      expect(serialScopeKey(scheme.serialUniquenessScope, entities)).toBe(v.expected.serialScopeKey);
    });
  }

  for (const v of vectors.serialErrors) {
    it(`rejects serial ${JSON.stringify(v.input)} with ${v.error}`, () => {
      expect(() => normalizeSerial(v.input, v.serialWidth)).toThrow(new TreeIdError(v.error));
    });
  }

  it('requires mandatory components', () => {
    const v = vectors.missingComponent;
    expect(() => assemblePhysicalId(v.scheme, v.values, '1')).toThrow(new TreeIdError(v.error));
  });

  for (const v of vectors.normalize) {
    it(`normalises ${JSON.stringify(v.input)}`, () => expect(normalizePhysicalId(v.input)).toBe(v.expected));
  }

  for (const v of vectors.invalidSchemes) {
    it(`rejects scheme: ${v.reason}`, () => expect(validateScheme(v.scheme).length).toBeGreaterThan(0));
  }
});
