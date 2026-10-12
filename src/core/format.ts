// Formátování čísel a dat. Čisté funkce bez závislosti na prohlížeči.

export type Locale = 'cs' | 'en';

const LOCALE_TAGS: Record<Locale, string> = { cs: 'cs-CZ', en: 'en-GB' };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Množství v kusech: celé číslo s oddělovačem tisíců podle jazyka. */
const quantityFormats = new Map<Locale, Intl.NumberFormat>();

export function formatQuantity(value: number, locale: Locale): string {
  let f = quantityFormats.get(locale);
  if (!f) quantityFormats.set(locale, (f = new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: 0 })));
  return f.format(value);
}

/** Krátké datum pro záhlaví tabulky: „12. 10.“ (cs) nebo „12/10“ (en). */
export function formatDayShort(isoDate: string, locale: Locale): string {
  const [, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return locale === 'cs' ? `${d}. ${m}.` : `${d}/${m}`;
}

/**
 * Kalendářní datum ve tvaru YYYY-MM-DD (termín odvolávky, datum exportu).
 * Nepracuje s časovým pásmem, takže se datum nikdy neposune o den.
 */
export function formatDate(isoDate: string, locale: Locale): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error(`Neplatné datum: "${isoDate}" (očekáváno YYYY-MM-DD)`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Neplatné datum: "${isoDate}"`);
  }
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
