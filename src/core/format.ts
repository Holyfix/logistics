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

/** Množství v dané jednotce: kusy celé, ostatní (kg, m …) nejvýš na 2 desetinná místa. */
const amountFormats = new Map<Locale, Intl.NumberFormat>();

export function formatAmount(value: number, locale: Locale, um = 'EA'): string {
  if (um === 'EA' || um === '') return formatQuantity(value, locale);
  let f = amountFormats.get(locale);
  if (!f) amountFormats.set(locale, (f = new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: 2 })));
  // Bez „-0“ u zaokrouhlených malých záporných hodnot.
  const rounded = Math.round(value * 100) / 100;
  return f.format(rounded === 0 ? 0 : rounded);
}

/** Číslo s jedním desetinným místem, např. „4,5“ (cs) nebo „4.5“ (en). */
const oneDecimalFormats = new Map<Locale, Intl.NumberFormat>();

export function formatOneDecimal(value: number, locale: Locale): string {
  let f = oneDecimalFormats.get(locale);
  if (!f) oneDecimalFormats.set(locale, (f = new Intl.NumberFormat(LOCALE_TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })));
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

/** Rozdíl se znaménkem: „+50“, „−1 200“ (typografické minus), nula bez znaménka. */
export function formatSigned(value: number, locale: Locale): string {
  const abs = formatQuantity(Math.abs(value), locale);
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
}

/** Procenta s nejvýše jedním desetinným místem; se znaménkem pro změnu („+12,5 %“). */
const percentFormats = new Map<Locale, Intl.NumberFormat>();

export function formatPercent(value: number, locale: Locale, signed = false): string {
  let f = percentFormats.get(locale);
  if (!f) percentFormats.set(locale, (f = new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: 1 })));
  const digits = f.format(Math.abs(value));
  const text = `${digits} %`;
  // Změna, která se zaokrouhlí na nulu, je bez znaménka.
  if (digits === '0') return text;
  if (!signed) return value < 0 ? `−${text}` : text;
  return value > 0 ? `+${text}` : `−${text}`;
}
