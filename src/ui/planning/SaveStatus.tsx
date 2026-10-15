import { useState } from 'react';
import type { Locale } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import type { SaveResult } from '../../platform/folder';

type Message = { tone: 'ok' | 'warn'; text: string };

export const formatModified = (ms: number, locale: Locale) => new Date(ms).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });

/** Uložení s potvrzením, když soubor mezitím změnil někdo jiný, a se zprávou o výsledku. */
export function useSaveFlow() {
  const { t, locale } = useI18n();
  const tp = t.planning;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const run = async (save: (force: boolean) => Promise<SaveResult>) => {
    setBusy(true);
    setMessage(null);
    try {
      let result = await save(false);
      if (result.status === 'conflict') {
        if (!window.confirm(`${tp.status.conflict} (${result.path}, ${formatModified(result.lastModified, locale)})`)) {
          setMessage({ tone: 'warn', text: tp.status.notSaved });
          return;
        }
        result = await save(true);
      }
      if (result.status === 'saved') setMessage({ tone: 'ok', text: `${tp.status.savedTo} ${result.path}` });
      else if (result.status === 'downloaded') setMessage({ tone: 'warn', text: tp.status.downloaded });
      else if (result.status === 'denied') setMessage({ tone: 'warn', text: tp.status.denied });
      else if (result.status === 'locked') setMessage({ tone: 'warn', text: `${tp.status.locked} (${result.path})` });
    } catch (error) {
      setMessage({ tone: 'warn', text: `${tp.status.error}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

/** Stav uložení: zpráva po uložení, neuložené změny, nebo kdy a kam byl soubor uložený. */
export function SaveStatus({ dirty, saved, message }: { dirty: boolean; saved: { path: string; lastModified: number } | null; message: Message | null }) {
  const { t, locale } = useI18n();
  const ts = t.planning.status;
  if (message?.tone === 'warn') return <span className="save-status save-dirty">{message.text}</span>;
  if (dirty) return <span className="save-status save-dirty">{ts.dirty}</span>;
  if (message) return <span className="save-status">{message.text}</span>;
  if (saved)
    return (
      <span className="save-status muted">
        {ts.saved} {saved.path} · {formatModified(saved.lastModified, locale)}
      </span>
    );
  return <span className="save-status muted">{ts.none}</span>;
}
