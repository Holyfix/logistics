// Zjištění, zda prohlížeč umí vše, co aplikace potřebuje.

export interface BrowserSupport {
  /** Čtení složky z disku (File System Access API) – jen Edge a Chrome. */
  directoryAccess: boolean;
  /** Uložení zpracovaných dat v prohlížeči. */
  indexedDb: boolean;
  /** Zpracování souborů na pozadí. */
  workers: boolean;
}

export function detectSupport(win: object = window): BrowserSupport {
  return {
    directoryAccess: 'showDirectoryPicker' in win,
    indexedDb: 'indexedDB' in win,
    workers: 'Worker' in win,
  };
}

export function isFullySupported(support: BrowserSupport): boolean {
  return support.directoryAccess && support.indexedDb && support.workers;
}
