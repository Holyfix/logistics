// Neuložené změny modulů skupiny Lidé (zůstanou při přechodu do jiného modulu, nové načtení složky je zahodí).

import type { SkillData } from '../../core/skills';
import type { VacationData } from '../../core/vacations';
import { createDraft } from '../createDraft';

const vacations = createDraft<VacationData>('Dovolené');
const skills = createDraft<SkillData>('Skill Matrix');

export const VacationsProvider = vacations.Provider;
export const useVacationsDraft = vacations.useDraft;
export const useVacationsDraftValue = vacations.useDraftValue;

export const SkillsProvider = skills.Provider;
export const useSkillsDraft = skills.useDraft;
export const useSkillsDraftValue = skills.useDraftValue;
