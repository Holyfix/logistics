import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ComponentLine, ProductDemand } from '../../core/components/compute';
import type { DayNumber } from '../../core/dates';
import { formatAmount, formatQuantity } from '../../core/format';
import type { StockRow } from '../../core/stock';
import { useI18n } from '../../i18n/I18nProvider';

/** Kolik lokací skladu se ukáže, než se zbytek sečte do „a další“. */
const MAX_LOCATIONS = 12;

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Rozpad výpočtu jedné komponenty krok po kroku: sklad po lokacích, potřeba každého hotového dílu (coverage nebo
 * odvolávky, volitelně po našem skladu hotového dílu) × kusovník, součet po dnech a z něj zásoba ve dnech.
 */
export function ComponentBreakdown({
  line,
  products,
  days,
  locations,
  netOwnStock,
  dayLabel,
  weekend,
  stockText,
  shortText,
  onClose,
}: {
  line: ComponentLine;
  products: ReadonlyMap<string, ProductDemand>;
  days: readonly DayNumber[];
  /** Lokace skladu komponenty; null, když soubor skladu není načtený. */
  locations: readonly StockRow[] | null;
  netOwnStock: boolean;
  dayLabel: (d: DayNumber) => string;
  weekend: (d: DayNumber) => string;
  stockText: (c: ComponentLine) => string;
  shortText: (c: ComponentLine) => string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const tb = t.components.breakdown;
  const [allProducts, setAllProducts] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), [line.item]);

  const amount = (v: number) => formatAmount(v, locale, line.um);
  /** Dny zásoby a kusovník až na 2 desetinná místa (0,5 dne, 0,25 kg). */
  const decimal = (v: number) => formatAmount(v, locale, '-');
  const qty = (v: number) => (Math.abs(v) < 1e-9 ? <span className="muted">0</span> : formatQuantity(v, locale));
  const stock = line.stock ?? 0;
  const ranked = [...line.perProduct].sort((a, b) => sum(b.usage) - sum(a.usage) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const used = ranked.filter((p) => sum(p.usage) > 1e-9);
  const shown = allProducts ? ranked : used;
  const idle = ranked.length - used.length;

  // Postup zásoby po dnech s potřebou (jen 14 dní tabulky): celý pokrytý den = 1, první nepokrytý jako podíl.
  const steps: { day: DayNumber; need: number; left: number; covered: number }[] = [];
  let left = Math.max(0, stock);
  for (let k = 0; k < days.length; k++) {
    const need = line.usage[k]!;
    if (need <= 1e-9) continue;
    const covered = left >= need - 1e-9 ? 1 : left / need;
    left = Math.max(0, left - need);
    steps.push({ day: days[k]!, need, left, covered });
    if (covered < 1) break;
  }
  const stepDays = sum(steps.map((s) => s.covered));
  const beyond = steps.length > 0 && steps.every((s) => s.covered === 1);

  const row = (label: string, values: readonly (number | null)[], cls = '', render: (v: number) => ReactNode = qty) => (
    <tr className={cls}>
      <td className="sticky-col">{label}</td>
      {values.map((v, k) => (
        <td key={k} className={`n${weekend(days[k]!)}${v !== null && v < -1e-9 ? ' cell-negative' : ''}`}>
          {v === null ? <span className="muted">—</span> : render(v)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="panel breakdown" ref={ref} role="region" aria-label={`${tb.heading} ${line.item}`}>
      <div className="panel-head">
        <h2>
          {tb.heading}: {line.item}
        </h2>
        <span className="muted">{line.description}</span>
        <span className="panel-actions">
          <button type="button" className="button button-small" onClick={onClose}>
            {tb.close}
          </button>
        </span>
      </div>

      <h3 className="breakdown-step">1. {tb.stock}</h3>
      {locations === null ? (
        <p className="muted">{tb.noStock}</p>
      ) : locations.length === 0 ? (
        <p className="muted">{tb.noLocations}</p>
      ) : (
        <table className="table table-data breakdown-locations">
          <thead>
            <tr>
              <th>{tb.location}</th>
              <th>{tb.zone}</th>
              <th className="n">{tb.qty}</th>
            </tr>
          </thead>
          <tbody>
            {locations.slice(0, MAX_LOCATIONS).map((r, i) => (
              <tr key={i}>
                <td>{r.location || '—'}</td>
                <td>{r.zone || '—'}</td>
                <td className="n">{amount(r.qty)}</td>
              </tr>
            ))}
            {locations.length > MAX_LOCATIONS && (
              <tr>
                <td colSpan={2} className="muted">
                  {tb.moreLocations.replace('{n}', formatQuantity(locations.length - MAX_LOCATIONS, locale))}
                </td>
                <td className="n">{amount(sum(locations.slice(MAX_LOCATIONS).map((r) => r.qty)))}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="row-total">
              <td colSpan={2}>{tb.stockTotal}</td>
              <td className="n">{amount(stock)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="muted">{tb.stockNote}</p>

      <h3 className="breakdown-step">2. {tb.products}</h3>
      <p className="muted">{netOwnStock ? tb.productsNoteNet : tb.productsNote}</p>
      <div className="table-scroll">
        <table className="table table-data breakdown-grid">
          <thead>
            <tr>
              <th className="sticky-col">{tb.row}</th>
              {days.map((d) => (
                <th key={d} className={`n${weekend(d)}`}>
                  {dayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          {shown.map((pp) => {
            const p = products.get(pp.item);
            if (!p) return null;
            // S odečtem skladu se část potřeby výroby může pokrýt mezivýrobou: komponenty je pak méně než výroba × kusovník.
            const fromIntermediate = p.production.some((q, k) => q * pp.qty - pp.usage[k]! > 1e-6);
            return (
              <tbody key={pp.item} className="breakdown-product">
                <tr className="breakdown-product-head">
                  <td colSpan={days.length + 1}>
                    <strong>{p.item}</strong> {p.description && <span className="muted">· {p.description}</span>}
                    {p.project && <span className="muted"> · {p.project}</span>}
                    {' · '}
                    {tb.bom.replace('{qty}', decimal(pp.qty)).replace('{um}', line.um || t.components.table.um)}
                    {' · '}
                    <span className={p.hasCoverage ? undefined : 'muted'}>{p.hasCoverage ? tb.sourceCoverage : tb.sourceCallOffs}</span>
                    {netOwnStock && p.ownStock !== null && ` · ${tb.ownStock} ${formatQuantity(p.ownStock, locale)}`}
                    {fromIntermediate && <span className="muted"> · {tb.intermediate}</span>}
                  </td>
                </tr>
                {p.hasCoverage && row(tb.customerBalance, p.customerBalance)}
                {row(tb.callOffs, p.callOffs)}
                {p.hasCoverage && row(tb.need, p.customerNeed)}
                {netOwnStock && row(tb.production, p.production)}
                {row(tb.usage.replace('{qty}', decimal(pp.qty)), pp.usage, 'breakdown-usage', amount)}
              </tbody>
            );
          })}
          <tfoot>
            {row(tb.usageTotal, line.usage, 'row-total', amount)}
            {row(tb.balance.replace('{stock}', amount(stock)), line.balance, 'row-total', amount)}
          </tfoot>
        </table>
      </div>
      {idle > 0 && (
        <p>
          <button type="button" className="link-button" onClick={() => setAllProducts((v) => !v)}>
            {allProducts ? tb.hideIdle : tb.showIdle.replace('{n}', formatQuantity(idle, locale))}
          </button>
        </p>
      )}

      <h3 className="breakdown-step">3. {tb.result}</h3>
      {steps.length === 0 ? (
        <p>{line.stockLastsHorizon && line.stockDays === 0 ? tb.noNeed : tb.noNeedHorizon}</p>
      ) : (
        <table className="table table-data breakdown-steps">
          <thead>
            <tr>
              <th>{tb.day}</th>
              <th className="n">{tb.dayNeed}</th>
              <th className="n">{tb.left}</th>
              <th className="n">{tb.covered}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.day}>
                <td>{dayLabel(s.day)}</td>
                <td className="n">{amount(s.need)}</td>
                <td className="n">{amount(s.left)}</td>
                <td className={`n${s.covered < 1 ? ' cell-negative' : ''}`}>{decimal(s.covered)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="row-total">
              <td colSpan={3}>{tb.stepsTotal}</td>
              <td className="n">{decimal(stepDays)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p>
        <strong>
          {t.components.table.until}: {stockText(line)}
        </strong>{' '}
        · {shortText(line)}
        {beyond && <span className="muted"> · {tb.beyond}</span>}
      </p>
    </div>
  );
}
