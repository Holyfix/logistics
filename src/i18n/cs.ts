export const cs = {
  appTagline: 'Logistický přehled',
  nav: {
    label: 'Hlavní navigace',
    overview: 'Přehled',
    data: 'Data',
  },
  language: {
    label: 'Jazyk',
    cs: 'Čeština',
    en: 'English',
  },
  support: {
    title: 'Tento prohlížeč neumí číst složky z disku',
    body: 'Aplikace potřebuje Microsoft Edge nebo Google Chrome na počítači. V jiném prohlížeči se data nenačtou.',
  },
  overview: {
    title: 'Přehled',
    emptyTitle: 'Zatím nejsou načtená žádná data',
    emptyBody:
      'V další verzi zde vyberete sdílenou složku s exporty z ERP. Aplikace z nich spočítá kritické díly, změny v odvolávkách a pokrytí materiálu.',
    plannedTitle: 'Připravované moduly',
    modules: {
      callOffs: 'Porovnání odvolávek',
      cums: 'Kontrola kumulativů',
      coverage: 'Material coverage',
      components: 'Komponenty přes kusovník',
    },
  },
  data: {
    title: 'Data',
    intro:
      'Aplikace bude číst tyto exporty ze sdílené složky. Soubory zůstávají ve firmě, do aplikace se nic nenahrává.',
    columns: {
      export: 'Export',
      format: 'Formát',
      frequency: 'Četnost',
      status: 'Stav',
    },
    exports: {
      callOffs: 'Odvolávky',
      shipments: 'Expedice a kumulativy',
      stock: 'Zásoby',
      bom: 'Kusovník',
      purchaseOrders: 'Otevřené nákupní objednávky',
    },
    frequency: {
      daily: 'denně',
      onChange: 'při změně',
    },
    planned: 'Připravujeme',
  },
  footer: {
    privacy: 'Data neopouštějí váš počítač.',
    version: 'Verze',
    built: 'sestaveno',
  },
};

export type Messages = typeof cs;
