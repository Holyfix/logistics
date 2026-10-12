# Architektura

Aplikace běží celá v prohlížeči ([ADR 0001](adr/0001-aplikace-v-prohlizeci.md)),
napsaná v TypeScriptu ([ADR 0002](adr/0002-typescript.md)).

```
GitHub Pages ── stáhne kód aplikace ──► Prohlížeč (Edge / Chrome)
                                         │
                ┌────────────────────────┤
                ▼                        ▼
   Sdílená složka (SharePoint/OneDrive)   IndexedDB (zpracovaná data, cache)
   exporty z ERP v CSV                    │
                                         ▼
                         Výpočty (src/core) → přehledy v Reactu
```

## Technologie

| Oblast | Volba |
|---|---|
| Jazyk | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Sestavení | Vite |
| Uživatelské rozhraní | React |
| Testy | Vitest (+ Testing Library pro komponenty) |
| Kontrola kódu | ESLint (typescript-eslint, react-hooks) |
| Písmo | Barlow, přibalené přes @fontsource (žádné externí požadavky) |
| Překlady | Vlastní typované slovníky `cs` / `en` (chybějící překlad = chyba při kompilaci) |
| Čtení složky | File System Access API (fáze 2) |
| Úložiště | IndexedDB (fáze 2) |
| Grafy | Apache ECharts (od fáze 3) |
| CI/CD | GitHub Actions → GitHub Pages |

## Struktura projektu

```
log1032/
├── src/
│   ├── core/        # čisté výpočty a pomocné funkce, bez DOM a Reactu (běží i v Node.js)
│   ├── platform/    # přístup k prohlížeči: podpora API, složky, IndexedDB, Web Worker
│   ├── i18n/        # slovníky cs/en a React kontext jazyka
│   ├── ui/          # React komponenty a stránky
│   ├── main.tsx     # vstupní bod
│   └── styles.css   # barevné a typografické tokeny, světlý a tmavý režim
├── scripts/         # pomocné skripty (kontrola datových souborů)
├── sample-data/     # jen smyšlená testovací data
├── docs/            # dokumentace a ADR
└── .github/workflows/
    ├── ci.yml       # kontroly při každém pushi
    └── deploy.yml   # nasazení na GitHub Pages z větve main
```

## Moduly (plán)

| Modul | Složka | Fáze |
|---|---|---|
| Načítání exportů (CSV, kontrola, cache) | `core/import`, `platform/folder`, `platform/store` | 2 |
| Kmenová data | `core/masterdata` | 2 |
| Odvolávky a porovnání | `core/calloffs`, `ui/calloffs` | 3 |
| Coverage a kusovník | `core/coverage`, `ui/coverage` | 4 |
| Úvodní obrazovka | `ui/overview` | 5 |
| Výroba | `core/production`, `ui/production` | 6 |

## Zásady

- **`src/core` nesmí importovat nic z `platform` ani `ui`.** Je testovatelné v Node.js a použitelné na serveru.
- **Nic se neodesílá.** Content-Security-Policy (`connect-src 'self'`) se vkládá při sestavení (`vite.config.ts`).
- **Data se nepřepisují.** Každý export je nová verze. Historie vzniká ze souborů ve složce.
- **Časy:** zobrazení v Europe/Prague. Termíny odvolávek jsou kalendářní data bez času.
- **Množství:** celá čísla v kusech, převod jednotek při načtení.
