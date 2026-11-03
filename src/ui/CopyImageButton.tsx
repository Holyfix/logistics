import { useState } from 'react';
import type { ImageTable } from '../core/tableImage';
import { useI18n } from '../i18n/I18nProvider';
import { copyTableImage } from '../platform/tableImage';

/** Kolik ms zůstane na tlačítku „Zkopírováno ✓“. */
const DONE_MS = 2500;

/**
 * Tlačítko „Kopírovat jako obrázek“: tabulka se sestaví až po kliknutí, vykreslí jako PNG a zkopíruje do schránky
 * (vložit do e-mailu nebo chatu); když prohlížeč schránku nepovolí, obrázek se stáhne.
 */
export function CopyImageButton({ build, fileName }: { build: () => ImageTable; fileName: string }) {
  const { t } = useI18n();
  const te = t.calloffs.export;
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'downloaded'>('idle');
  const copy = async () => {
    setState('busy');
    try {
      setState(await copyTableImage(build(), fileName));
    } catch {
      setState('idle');
      return;
    }
    setTimeout(() => setState('idle'), DONE_MS);
  };
  return (
    <button type="button" className="button button-small" disabled={state === 'busy'} title={te.imageTitle} onClick={() => void copy()}>
      {state === 'copied' ? te.imageCopied : state === 'downloaded' ? te.imageDownloaded : te.image}
    </button>
  );
}
