import type { Messages } from './cs';

export const en: Messages = {
  appTagline: 'Logistics overview',
  nav: {
    label: 'Main navigation',
    overview: 'Overview',
    data: 'Data',
  },
  language: {
    label: 'Language',
    cs: 'Čeština',
    en: 'English',
  },
  support: {
    title: 'This browser cannot read folders from disk',
    body: 'The app needs Microsoft Edge or Google Chrome on a computer. Other browsers cannot load the data.',
  },
  overview: {
    title: 'Overview',
    emptyTitle: 'No data loaded yet',
    emptyBody:
      'In the next version you will select the shared folder with ERP exports here. The app will use them to calculate critical parts, call-off changes and material coverage.',
    plannedTitle: 'Upcoming modules',
    modules: {
      callOffs: 'Call-off comparison',
      cums: 'Cumulative quantity check',
      coverage: 'Material coverage',
      components: 'Components via bill of materials',
    },
  },
  data: {
    title: 'Data',
    intro:
      'The app will read these exports from the shared folder. Files stay inside the company; nothing is uploaded to the app.',
    columns: {
      export: 'Export',
      format: 'Format',
      frequency: 'Frequency',
      status: 'Status',
    },
    exports: {
      callOffs: 'Call-offs',
      shipments: 'Shipments and cumulative quantities',
      stock: 'Stock',
      bom: 'Bill of materials',
      purchaseOrders: 'Open purchase orders',
    },
    frequency: {
      daily: 'daily',
      onChange: 'on change',
    },
    planned: 'Planned',
  },
  footer: {
    privacy: 'Your data never leaves your computer.',
    version: 'Version',
    built: 'built',
  },
};
