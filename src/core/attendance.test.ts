import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import {
  dayInfos,
  fixEncoding,
  lastWorkedDay,
  mergeAttendance,
  monthsOf,
  noteCodes,
  overtimeByPeriod,
  overtimeRanges,
  parseAttendanceSheets,
  personName,
  summarize,
  type AttendanceData,
} from './attendance';
import { dayFromParts } from './dates';
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
  it('opraví text exportu ve špatném kódování (Windows-1250 čtené jako Windows-1252), správný text nechá', () => {
    expect(fixEncoding('Pøíjmení Jméno')).toBe('Příjmení Jméno');
    expect(fixEncoding('Lékaø')).toBe('Lékař');
    expect(fixEncoding('Kuèera')).toBe('Kučera');
    // „ť“ je ve Windows-1250 bajt 0x9D, který Windows-1252 nemá – v exportu zbyde neviditelný řídicí znak.
    expect(fixEncoding('\u0160\u009dáva')).toBe('Šťáva');
    expect(fixEncoding('Příjmení')).toBe('Příjmení');
    expect(fixEncoding('Šťáva Kučera')).toBe('Šťáva Kučera');
    expect(fixEncoding('Poznámka – ok')).toBe('Poznámka – ok');
    expect(fixEncoding('HO')).toBe('HO');
  });

  it('jméno bez pozice za čárkou', () => {
    expect(personName('Novák Jan, Logistik')).toBe('Novák Jan');
    expect(personName('Novák Jan')).toBe('Novák Jan');
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

  it('načte export: lidé bez pozice a s opravenou diakritikou, mzdové složky po dnech, poznámky', async () => {
    const data = await loadSample();
    expect(data.people.map((p) => [p.name, p.center])).toEqual([
      ['Nováková Jana', 'Sklad A'],
      ['Kučera Petr', 'Sklad A'],
      ['Šťáva Tomáš', 'Expedice B'],
    ]);
    expect(data.categories).toEqual(['Fond', 'Celkem odpracováno', 'Celkem započteno', 'Přesčas evidence', 'Lékař', 'Uznáno .před', 'Dovolená', 'Služební cesta']);
    expect(monthsOf(data)).toEqual(['2026-11']);
    expect(data.notes).toHaveLength(7);
  });

  it('přehled po lidech: fond do dneška, saldo, přesčasy a dny podle zkratek (bez dvojího počítání)', async () => {
    const rows = summarize(await loadSample(), '2026-11');
    const jana = rows.find((r) => r.person.name === 'Nováková Jana')!;
    // Odpracováno do 10. 11. (7 pracovních dní): fond 56 h, započteno 57,5 h.
    // Přesčasy k dispozici: +1,5 h (2. 11.); 3. 11. 4 h práce + 4 h lékař = 0 (lékař přesčas nesnižuje).
    expect(jana).toMatchObject({ fond: 160, fondToDate: 56, worked: 53.5, balance: 1.5, overtime: 1.5, approved: 1.5, doctor: 4 });
    expect(Object.fromEntries(jana.days)).toEqual({ L: 0.5, HO: 1.5 });
    const petr = rows.find((r) => r.person.name === 'Kučera Petr')!;
    // Dovolená ze mzdové složky i z poznámky se počítá jednou.
    expect(petr).toMatchObject({ worked: 40, vacationHours: 16, balance: 0 });
    expect(Object.fromEntries(petr.days)).toEqual({ DOV: 2 });
    const tomas = rows.find((r) => r.person.name === 'Šťáva Tomáš')!;
    // Dřívější odchod (7 h z 8) snižuje přesčas i saldo.
    expect(tomas).toMatchObject({ worked: 55, overtime: -1, balance: -1 });
    expect(Object.fromEntries(tomas.days)).toEqual({ SC: 1, NV: 1 });
    expect(summarize(await loadSample(), '2026-10').every((r) => r.worked === 0)).toBe(true);
  });

  it('den osoby: zkratky, odpracováno a fond', async () => {
    const data = await loadSample();
    const jana = dayInfos(data, '2026-11').get('900001')!;
    const day = (d: number) => jana.get(dayFromParts(2026, 11, d)!)!;
    expect(Object.fromEntries(day(3).codes)).toEqual({ L: 0.5 });
    expect(day(3)).toMatchObject({ worked: 4, fond: 8 });
    expect(Object.fromEntries(day(10).codes)).toEqual({ HO: 0.5 });
  });

  it('přesčasy za týden, měsíc, rok a celkem k poslednímu dni s docházkou', async () => {
    const data = await loadSample();
    const reference = lastWorkedDay(data)!;
    expect(reference).toBe(dayFromParts(2026, 11, 10));
    const ranges = overtimeRanges(data, reference);
    expect(ranges.week).toEqual({ from: dayFromParts(2026, 11, 9), to: reference });
    expect(ranges.month.from).toBe(dayFromParts(2026, 11, 1));
    expect(ranges.year.from).toBe(dayFromParts(2026, 1, 1));
    const byPeriod = overtimeByPeriod(data, reference);
    expect(byPeriod.get('900001')).toEqual({ week: 0, month: 1.5, year: 1.5, total: 1.5 });
    expect(byPeriod.get('900003')).toEqual({ week: -1, month: -1, year: -1, total: -1 });
    // Starší měsíc přidá do roku a celkem, do týdne ani měsíce ne.
    const october: AttendanceData = { ...data, values: [{ person: '900001', category: 'Přesčas evidence', day: dayFromParts(2026, 10, 15)!, value: 2 }] };
    expect(overtimeByPeriod(mergeAttendance([october, data]), reference).get('900001')).toEqual({ week: 0, month: 1.5, year: 3.5, total: 3.5 });
  });

  it('více měsíců: pozdější export přepíše stejný den', async () => {
    const a = await loadSample();
    const b: AttendanceData = { ...a, values: a.values.map((v) => ({ ...v, value: v.category === 'Fond' ? 7.5 : v.value })) };
    const merged = mergeAttendance([a, b]);
    expect(merged.values).toHaveLength(a.values.length);
    expect(summarize(merged, null).find((r) => r.person.name === 'Kučera Petr')!.fond).toBe(150);
  });
});
