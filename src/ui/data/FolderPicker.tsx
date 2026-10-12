import { useRef } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { useData } from './DataProvider';

/** Tlačítka pro výběr složky: uložená složka v Edge/Chrome, jinak jednorázový výběr. */
export function FolderPicker({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { state, chooseFolder, chooseFiles, grantPermission, reload, rememberFolder } = useData();
  const input = useRef<HTMLInputElement>(null);
  const hasFolder = state.status === 'ready' || state.status === 'error' || state.status === 'loading';

  const choose = () => (rememberFolder ? void chooseFolder() : input.current?.click());

  return (
    <div className="actions-row">
      {state.status === 'needsPermission' ? (
        <button type="button" className="button button-primary" onClick={() => void grantPermission()}>
          {t.data.folder.grant}
        </button>
      ) : (
        <button type="button" className={`button${hasFolder ? '' : ' button-primary'}`} onClick={choose} disabled={state.status === 'loading'}>
          {hasFolder ? t.data.folder.change : t.data.folder.choose}
        </button>
      )}
      {!compact && state.status === 'ready' && rememberFolder && (
        <button type="button" className="button" onClick={() => void reload()}>
          {t.data.folder.reload}
        </button>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // Výběr celé složky v prohlížečích bez File System Access API.
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          if (e.target.files?.length) void chooseFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
