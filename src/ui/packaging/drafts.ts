// Neuložené změny modulu Obaly (zůstanou při přechodu do jiného modulu, nové načtení složky je zahodí).

import type { PackList } from '../../core/packaging';
import { createDraft } from '../createDraft';

const packaging = createDraft<PackList>('Obaly');

export const PackagingProvider = packaging.Provider;
export const usePackagingDraft = packaging.useDraft;
export const usePackagingDraftValue = packaging.useDraftValue;
