import type { Messages } from './cs';

export const en: Messages = {
  appTagline: 'Logistics overview',
  nav: {
    home: 'Home',
    back: 'Back to home',
    breadcrumb: 'Location',
    homeLabel: 'Logistics – back to home',
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
  hub: {
    title: 'Home',
    intro: 'Choose a module. Once data is loaded, the tiles will show the key figure and status.',
    groups: {
      overview: 'Overviews',
      customers: 'Customers',
      material: 'Material and warehouse',
      production: 'Production',
      suppliers: 'Suppliers',
      management: 'Management',
      system: 'System',
    },
    phase: 'Phase',
    later: 'Later',
  },
  module: {
    featuresTitle: 'What the module will do',
    plannedNote: 'This module is in development. The order of modules is in the project roadmap.',
    laterNote: 'This module is postponed and will be added later.',
  },
  modules: {
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Daily overview',
      description: 'What needs attention today, on one screen.',
      features: [
        'Critical parts and components',
        'Significant call-off changes in the last 24 hours',
        "Yesterday's plan fulfilment and downtime",
        'How many days the packaging will last',
        'Freshness of loaded data',
      ],
    },
    kpi: {
      title: 'KPI',
      subtitle: 'Indicators over time',
      description: 'How we are doing week by week and month by month.',
      features: [
        'Indicator trends by week and month',
        'Targets and trend direction',
        'Call-off stability, plan fulfilment, material-related downtime, coverage',
      ],
    },
    calloffs: {
      title: 'Call-offs',
      subtitle: 'Customer schedules',
      description: 'What customers need and how it changes.',
      features: [
        'Comparison of the current and previous call-off version',
        'Changes in the firm horizon and above a configurable threshold',
        'New and cancelled dates',
        'Weekly demand by customer',
      ],
    },
    shipments: {
      title: 'Shipments',
      subtitle: 'OTD outbound',
      description: 'Are we delivering to customers on time?',
      features: ['On-time delivery to customers', 'Backlog', 'Premium freight'],
    },
    express: {
      title: 'Premium freight',
      subtitle: 'Special transports',
      description: 'What premium freight costs us and why it happens.',
      features: ['Premium freight entry in the app', 'Cause, cost and responsibility', 'Count and cost over time'],
    },
    coverage: {
      title: 'Coverage',
      subtitle: 'Finished goods coverage',
      description: 'Will finished goods cover the call-offs?',
      features: ['14-day stock projection', 'Coverage in days with traffic light', 'Date a part runs out'],
    },
    components: {
      title: 'Components',
      subtitle: 'Via bill of materials',
      description: 'Do we have material for production?',
      features: [
        'Demand exploded through the bill of materials',
        'Coverage of purchased components',
        'Open purchase orders',
        'Shortage list for the morning meeting',
      ],
    },
    stock: {
      title: 'Stock',
      subtitle: 'Warehouse health',
      description: 'Do we have too much or too little stock?',
      features: ['Stock in days of consumption', 'Parts above maximum and below minimum', 'Slow movers without movement'],
    },
    packaging: {
      title: 'Packaging',
      subtitle: 'Morning packaging count',
      description: 'How much packaging we have and how many parts it covers.',
      features: [
        'Morning entry of packaging counts from the stock take',
        'How many parts and days the packaging covers, based on call-offs',
        'Packaging stock over time',
      ],
    },
    production: {
      title: 'Planning',
      subtitle: 'Plan fulfilment and downtime',
      description: 'Did we produce what we planned? If not, why?',
      features: [
        'Plan vs. actual by day, shift and line',
        'Downtime by cause (Pareto)',
        'Downtime caused by missing material',
      ],
    },
    inbound: {
      title: 'Inbound',
      subtitle: 'Expected deliveries',
      description: 'What should arrive today and tomorrow, and what is overdue.',
      features: ['Expected deliveries for today and tomorrow', 'Overdue deliveries', 'Link to the component shortage list'],
    },
    suppliers: {
      title: 'Suppliers',
      subtitle: 'OTD inbound',
      description: 'Are suppliers delivering on time?',
      features: ['Supplier on-time delivery', 'Late purchase orders', 'Supplier rating'],
    },
    actions: {
      title: 'Action plan',
      subtitle: 'Meeting actions',
      description: 'Who handles what and by when. Details to be specified.',
      features: ['Actions from meetings', 'Owner, due date and status'],
    },
    reports: {
      title: 'Reports',
      subtitle: 'Weekly report',
      description: 'A summary for management in one click.',
      features: ['Weekly summary from the other modules', 'Export to PDF and Excel'],
    },
    data: {
      title: 'Data',
      subtitle: 'Loaded exports',
      description: 'Shared folder, export status and loading errors.',
      features: ['Shared folder selection', 'Status of loaded exports', 'Data errors'],
    },
    settings: {
      title: 'Settings',
      subtitle: 'Thresholds and user',
      description: 'Traffic light thresholds, projection horizon, name for entries.',
      features: ['Traffic light thresholds', 'Projection horizon', 'User name for entries (packaging, action plan)'],
    },
  },
  data: {
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
      shipments: 'Shipments',
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
    privacy: 'The app never sends your data anywhere.',
    version: 'Version',
    built: 'built',
  },
};
