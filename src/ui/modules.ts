// Katalog modulů aplikace. Texty (názvy, popisy, funkce) jsou ve slovnících src/i18n.

import type { IconName } from './icons';

export type ModuleId =
  | 'dashboard'
  | 'kpi'
  | 'calloffs'
  | 'coverage'
  | 'shipments'
  | 'express'
  | 'components'
  | 'stock'
  | 'packaging'
  | 'production'
  | 'inbound'
  | 'suppliers'
  | 'actions'
  | 'reports'
  | 'data'
  | 'settings';

export type ModuleGroup =
  | 'overview'
  | 'customers'
  | 'material'
  | 'production'
  | 'suppliers'
  | 'management'
  | 'system';

/** available = funguje, planned = ve vývoji (číslo fáze z roadmapy), later = odloženo. */
export type ModuleStatus = { kind: 'available' } | { kind: 'planned'; phase: number } | { kind: 'later' };

export interface ModuleDef {
  id: ModuleId;
  group: ModuleGroup;
  icon: IconName;
  status: ModuleStatus;
}

/** Pořadí skupin na rozcestníku shora dolů. */
export const GROUPS: ModuleGroup[] = [
  'overview',
  'customers',
  'material',
  'production',
  'suppliers',
  'management',
  'system',
];

export const MODULES: ModuleDef[] = [
  { id: 'dashboard', group: 'overview', icon: 'dashboard', status: { kind: 'planned', phase: 6 } },
  { id: 'kpi', group: 'overview', icon: 'kpi', status: { kind: 'planned', phase: 8 } },
  { id: 'calloffs', group: 'customers', icon: 'calloffs', status: { kind: 'available' } },
  { id: 'coverage', group: 'customers', icon: 'coverage', status: { kind: 'planned', phase: 4 } },
  { id: 'shipments', group: 'customers', icon: 'shipments', status: { kind: 'later' } },
  { id: 'express', group: 'customers', icon: 'express', status: { kind: 'later' } },
  { id: 'components', group: 'material', icon: 'components', status: { kind: 'planned', phase: 4 } },
  { id: 'stock', group: 'material', icon: 'stock', status: { kind: 'planned', phase: 9 } },
  { id: 'packaging', group: 'material', icon: 'packaging', status: { kind: 'planned', phase: 5 } },
  { id: 'production', group: 'production', icon: 'production', status: { kind: 'planned', phase: 7 } },
  { id: 'inbound', group: 'suppliers', icon: 'inbound', status: { kind: 'planned', phase: 9 } },
  { id: 'suppliers', group: 'suppliers', icon: 'suppliers', status: { kind: 'later' } },
  { id: 'actions', group: 'management', icon: 'actions', status: { kind: 'later' } },
  { id: 'reports', group: 'management', icon: 'reports', status: { kind: 'later' } },
  { id: 'data', group: 'system', icon: 'data', status: { kind: 'available' } },
  { id: 'settings', group: 'system', icon: 'settings', status: { kind: 'planned', phase: 3 } },
];

export function findModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
