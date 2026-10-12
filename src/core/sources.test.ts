import { describe, expect, it } from 'vitest';
import { classifyPath } from './sources';

describe('classifyPath', () => {
  it.each([
    ['Odvolávky_CW42.csv', 'calloffs'],
    ['odvolavky/export_42.csv', 'calloffs'],
    ['Call-offs/CW42.xlsx', 'calloffs'],
    ['kmenova-data.xlsx', 'masterdata'],
    ['Kmenová data dílů.csv', 'masterdata'],
    ['odvolavky/~$Odvolávky_CW42.xlsx', 'ignored'],
    ['zasoby/CW42.csv', 'ignored'],
    ['Odvolávky_CW42.pdf', 'ignored'],
  ])('%s → %s', (path, kind) => expect(classifyPath(path)).toBe(kind));
});
