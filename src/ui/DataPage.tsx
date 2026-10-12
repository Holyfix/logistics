import { useI18n } from '../i18n/I18nProvider';

export function DataPage() {
  const { t } = useI18n();
  const rows = [
    { name: t.data.exports.callOffs, frequency: t.data.frequency.daily },
    { name: t.data.exports.shipments, frequency: t.data.frequency.daily },
    { name: t.data.exports.stock, frequency: t.data.frequency.daily },
    { name: t.data.exports.bom, frequency: t.data.frequency.onChange },
    { name: t.data.exports.purchaseOrders, frequency: t.data.frequency.daily },
  ];

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{t.modules.data.title}</h1>
      <p className="lead">{t.data.intro}</p>
      <div className="panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t.data.columns.export}</th>
                <th>{t.data.columns.format}</th>
                <th>{t.data.columns.frequency}</th>
                <th>{t.data.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>CSV</td>
                  <td>{row.frequency}</td>
                  <td>
                    <span className="chip">{t.data.planned}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
