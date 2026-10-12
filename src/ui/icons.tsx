// Jednoduché čárové ikony 24×24 pro dlaždice modulů.

const PATHS = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </>
  ),
  kpi: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M7 15l4-4 3 3 5-6" />
      <path d="M15 8h4v4" />
    </>
  ),
  calloffs: (
    <>
      <path d="M7 3.5h7l4 4V20.5H6.5V3.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12h6M9 15h6M9 18h3" />
    </>
  ),
  shipments: (
    <>
      <path d="M2.5 6.5h11v10h-11z" />
      <path d="M13.5 10h4l3 3v3.5h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  express: <path d="M13 3.5L5.5 13H12l-1 7.5L18.5 11H12z" />,
  coverage: (
    <>
      <path d="M3 7.5l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 16.5l9 4 9-4" />
    </>
  ),
  components: (
    <>
      <rect x="9" y="3.5" width="6" height="5" rx="1" />
      <rect x="3" y="15.5" width="6" height="5" rx="1" />
      <rect x="15" y="15.5" width="6" height="5" rx="1" />
      <path d="M12 8.5v3.5M6 15.5V12h12v3.5" />
    </>
  ),
  stock: (
    <>
      <path d="M3.5 20.5V9l8.5-5 8.5 5v11.5" />
      <path d="M7.5 20.5v-7h9v7M7.5 16.5h9" />
    </>
  ),
  packaging: (
    <>
      <path d="M3.5 8l8.5-4.5L20.5 8v8.5L12 21l-8.5-4.5z" />
      <path d="M3.5 8L12 12.5 20.5 8M12 12.5V21" />
      <path d="M7.8 5.8l8.4 4.5" />
    </>
  ),
  production: (
    <>
      <path d="M3 20.5V10l5 3V10l5 3V6l8 4v10.5z" />
      <path d="M3 20.5h18" />
    </>
  ),
  inbound: (
    <>
      <path d="M12 3.5v10M8 9.5l4 4 4-4" />
      <path d="M4 14.5v5h16v-5" />
    </>
  ),
  suppliers: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M2.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M14 14.6c.8-.4 1.6-.6 2.5-.6 2.3 0 4.2 1.5 4.8 4.5" />
    </>
  ),
  actions: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M3.5 6.5l1.3 1.3L7 5.5M3.5 12l1.3 1.3L7 11" />
      <rect x="3.5" y="16" width="3" height="3" rx=".5" />
    </>
  ),
  reports: (
    <>
      <path d="M7 3.5h7l4 4V20.5H6.5V3.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9.5 17v-3M12 17v-5M14.5 17v-2" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.5" />
      <path d="M4.5 6v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6" />
      <path d="M4.5 12v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
