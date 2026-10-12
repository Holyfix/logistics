export const cs = {
  appTagline: 'Logistický přehled',
  nav: {
    home: 'Rozcestník',
    back: 'Zpět na rozcestník',
    breadcrumb: 'Umístění',
    homeLabel: 'Logistics – zpět na rozcestník',
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
  hub: {
    title: 'Rozcestník',
    intro: 'Vyberte modul. Až budou načtená data, dlaždice ukážou hlavní číslo a stav.',
    groups: {
      overview: 'Přehledy',
      customers: 'Zákazníci',
      material: 'Materiál a sklad',
      production: 'Výroba',
      suppliers: 'Dodavatelé',
      management: 'Řízení',
      system: 'Systém',
    },
    phase: 'Fáze',
    later: 'Později',
  },
  module: {
    featuresTitle: 'Co bude modul umět',
    plannedNote: 'Modul je ve vývoji. Pořadí modulů je v roadmapě projektu.',
    laterNote: 'Modul je odložený a doplní se později.',
  },
  modules: {
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Denní přehled',
      description: 'Co je dnes potřeba řešit, na jedné obrazovce.',
      features: [
        'Kritické díly a komponenty',
        'Významné změny v odvolávkách za posledních 24 hodin',
        'Plnění plánu a prostoje za včerejšek',
        'Na kolik dní vystačí obaly',
        'Čerstvost načtených dat',
      ],
    },
    kpi: {
      title: 'KPI',
      subtitle: 'Ukazatele v čase',
      description: 'Jak se nám daří po týdnech a měsících.',
      features: [
        'Vývoj ukazatelů po týdnech a měsících',
        'Cílové hodnoty a trend',
        'Stabilita odvolávek, plnění plánu, prostoje kvůli materiálu, pokrytí',
      ],
    },
    calloffs: {
      title: 'Call-offs',
      subtitle: 'Odvolávky',
      description: 'Co zákazníci chtějí a jak se to mění.',
      features: [
        'Porovnání aktuální a předchozí verze odvolávky',
        'Změny v závazném horizontu a nad nastavitelným prahem',
        'Nové a zrušené termíny',
        'Poptávka po týdnech podle zákazníků',
      ],
    },
    shipments: {
      title: 'Expedice a dodávky',
      subtitle: 'OTD outbound',
      description: 'Dodáváme zákazníkům včas?',
      features: ['Včasnost dodávek zákazníkům', 'Dlužné dodávky', 'Mimořádné přepravy'],
    },
    express: {
      title: 'Mimořádné přepravy',
      subtitle: 'Premium freight',
      description: 'Kolik nás stojí mimořádné přepravy a proč vznikají.',
      features: ['Zápis mimořádné přepravy přímo v aplikaci', 'Příčina, náklad a odpovědnost', 'Vývoj počtu a nákladů v čase'],
    },
    coverage: {
      title: 'Coverage',
      subtitle: 'Pokrytí hotových výrobků',
      description: 'Vystačí hotové výrobky na odvolávky?',
      features: ['Výhled zásob na 14 dní', 'Pokrytí ve dnech a semafor', 'Datum, kdy díl dojde'],
    },
    components: {
      title: 'Komponenty',
      subtitle: 'Přes kusovník',
      description: 'Máme materiál na výrobu?',
      features: [
        'Rozpad poptávky přes kusovník',
        'Pokrytí nakupovaných komponent',
        'Otevřené nákupní objednávky',
        'Shortage list pro ranní poradu',
      ],
    },
    stock: {
      title: 'Zásoby',
      subtitle: 'Zdraví skladu',
      description: 'Nemáme zásob moc nebo málo?',
      features: ['Zásoba ve dnech spotřeby', 'Díly nad maximem a pod minimem', 'Ležáky bez pohybu'],
    },
    packaging: {
      title: 'Obaly',
      subtitle: 'Ranní inventura obalů',
      description: 'Kolik máme obalů a na kolik dílů vystačí.',
      features: [
        'Ranní zápis počtu obalů podle inventury',
        'Na kolik dílů a dní obaly vystačí podle odvolávek',
        'Vývoj stavu obalů v čase',
      ],
    },
    production: {
      title: 'Plánování',
      subtitle: 'Plnění plánu a prostoje',
      description: 'Vyrobili jsme, co jsme měli? A pokud ne, proč?',
      features: [
        'Plán vs. skutečnost po dnech, směnách a linkách',
        'Prostoje podle příčin (Pareto)',
        'Prostoje kvůli chybějícímu materiálu',
      ],
    },
    inbound: {
      title: 'Příjem',
      subtitle: 'Očekávané dodávky',
      description: 'Co má dnes a zítra přijet a co je po termínu.',
      features: [
        'Očekávané dodávky na dnes a zítra',
        'Dodávky po termínu',
        'Vazba na shortage list komponent',
      ],
    },
    suppliers: {
      title: 'Dodavatelé',
      subtitle: 'OTD inbound',
      description: 'Dodávají nám dodavatelé včas?',
      features: ['Včasnost dodávek dodavatelů', 'Zpožděné objednávky', 'Hodnocení dodavatelů'],
    },
    actions: {
      title: 'Akční plán',
      subtitle: 'Úkoly z porad',
      description: 'Kdo co řeší a do kdy. Podrobnosti se upřesní.',
      features: ['Úkoly z porad', 'Odpovědná osoba, termín a stav'],
    },
    reports: {
      title: 'Reporty',
      subtitle: 'Týdenní report',
      description: 'Souhrn pro vedení na jedno kliknutí.',
      features: ['Týdenní souhrn z ostatních modulů', 'Export do PDF a Excelu'],
    },
    data: {
      title: 'Data',
      subtitle: 'Načtené exporty',
      description: 'Sdílená složka, stav exportů a chyby při načtení.',
      features: ['Výběr sdílené složky', 'Stav načtených exportů', 'Chyby v datech'],
    },
    settings: {
      title: 'Nastavení',
      subtitle: 'Prahy a uživatel',
      description: 'Prahy semaforu, horizont výhledu, jméno pro zápisy.',
      features: ['Prahy semaforu', 'Horizont výhledu', 'Jméno uživatele pro zápisy (obaly, akční plán)'],
    },
  },
  data: {
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
      shipments: 'Expedice',
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
    privacy: 'Aplikace nikam neodesílá vaše data.',
    version: 'Verze',
    built: 'sestaveno',
  },
};

export type Messages = typeof cs;
