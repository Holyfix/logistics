import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import { fixEncoding, mergeAttendance, monthsOf, noteCodes, parseAttendanceSheets, summarize, type AttendanceData } from './attendance';
import { decryptOffice, isEncryptedOffice, isPlainXlsx, OfficeCryptoError } from './officeCrypto';
import type { Cell } from './table';

// Smyšlený export docházky zašifrovaný heslem „vzor2026“ (sample-data, žádná skutečná data).
const SAMPLE = 'sample-data/Lide/Dochazka/pruchody_vzor_11-2026.xlsx';
const sampleBuffer = () => {
  const b = readFileSync(SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

async function loadSample(): Promise<AttendanceData> {
  const plain = await decryptOffice(sampleBuffer(), 'vzor2026');
  const sheets = await readXlsxFile(Buffer.from(plain));
  const result = parseAttendanceSheets(sheets.map((s) => s.data as Cell[][]));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('Šifrovaný sešit Excelu', () => {
  it('pozná šifrovaný sešit, se správným heslem ho rozšifruje, se špatným nahlásí špatné heslo', async () => {
    const buffer = sampleBuffer();
    expect(isEncryptedOffice(buffer)).toBe(true);
    await expect(decryptOffice(buffer, 'spatne')).rejects.toMatchObject({ code: 'wrongPassword' });
    const plain = await decryptOffice(buffer, 'vzor2026');
    expect(isPlainXlsx(plain)).toBe(true);
    expect(isEncryptedOffice(plain)).toBe(false);
    await expect(decryptOffice(plain, 'vzor2026')).rejects.toBeInstanceOf(OfficeCryptoError);
  });
});

describe('Docházka', () => {
  it('opraví text exportu ve špatném kódování, správný text nechá', () => {
    expect(fixEncoding('Pøíjmení Jméno')).toBe('Příjmení Jméno');
    expect(fixEncoding('Lékaø')).toBe('Lékař');
    expect(fixEncoding('Příjmení')).toBe('Příjmení');
    expect(fixEncoding('Poznámka')).toBe('Poznámka');
    expect(fixEncoding('HO')).toBe('HO');
  });

  it('zkratky z poznámky dne', () => {
    expect([...noteCodes('ok, HO')]).toEqual([['HO', 1]]);
    expect([...noteCodes('1/2HO')]).toEqual([['HO', 0.5]]);
    expect([...noteCodes('ok, 1/2NV')]).toEqual([['NV', 0.5]]);
    expect([...noteCodes('lékař/NV')]).toEqual([
      ['LÉKAŘ', 1],
      ['NV', 1],
    ]);
    expect([...noteCodes('72.5')]).toEqual([]);
  });

  it('načte export: lidé, mzdové složky po dnech (bez týdenních součtů), poznámky', async () => {
    const data = await loadSample();
    expect(data.people.map((p) => [p.name, p.center])).toEqual([
      ['Nováková Jana', 'Sklad A'],
      ['Dvořák Petr', 'Sklad A'],
      ['Svoboda Tomáš', 'Expedice B'],
    ]);
    expect(data.categories).toEqual(['Fond', 'Celkem odpracováno', 'Přesčas evidence', 'Lékař', 'Uznáno .před', 'Dovolená', 'Služební cesta']);
    expect(monthsOf(data)).toEqual(['2026-11']);
    expect(data.notes).toHaveLength(7);
  });

  it('přehled po lidech: fond, odpracováno, přesčasy, lékař, dovolená, HO a další z poznámek', async () => {
    const rows = summarize(await loadSample(), '2026-11');
    const jana = rows.find((r) => r.person.name === 'Nováková Jana')!;
    expect(jana).toMatchObject({ fond: 160, worked: 53.5, overtime: 1.5, approved: 1.5, doctor: 4 });
    expect([...jana.codes]).toEqual([
      ['LÉKAŘ', 1],
      ['HO', 1.5],
    ]);
    const petr = rows.find((r) => r.person.name === 'Dvořák Petr')!;
    expect(petr).toMatchObject({ worked: 40, vacationHours: 16, overtime: 0 });
    expect(petr.codes.get('DOV')).toBe(2);
    const tomas = rows.find((r) => r.person.name === 'Svoboda Tomáš')!;
    expect(tomas).toMatchObject({ tripHours: 8 });
    expect(tomas.codes.get('NV')).toBe(1);
    expect(summarize(await loadSample(), '2026-10').every((r) => r.worked === 0)).toBe(true);
  });

  it('více měsíců: pozdější export přepíše stejný den', async () => {
    const a = await loadSample();
    const b: AttendanceData = { ...a, values: a.values.map((v) => ({ ...v, value: v.category === 'Fond' ? 7.5 : v.value })) };
    const merged = mergeAttendance([a, b]);
    expect(merged.values).toHaveLength(a.values.length);
    expect(summarize(merged, null).find((r) => r.person.name === 'Dvořák Petr')!.fond).toBe(150);
  });
});
