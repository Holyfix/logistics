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
| Čtení složky | File System Access API (Edge, Chrome), jinak `<input webkitdirectory>` |
| Úložiště | IndexedDB (uložená složka, zpracované exporty) |
| Excel | read-excel-file (čtení), write-excel-file (export) |
| Grafy | Apache ECharts (od fáze 3) |
| CI/CD | GitHub Actions → GitHub Pages |

## Struktura projektu

```
logistics/
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

## Moduly

Seznam modulů, skupiny a stav jsou v `src/ui/modules.ts`, popis v [MODULES.md](MODULES.md).
Výpočty každého modulu budou v `src/core/<modul>`, zobrazení v `src/ui/<modul>`.
Rozcestník (`src/ui/HubPage.tsx`) zobrazí kartu pro každou skupinu a v ní řádek pro každý modul. Adresa `#<id-modulu>`
otevře modul, cokoli jiného rozcestník.

## Zásady

- **`src/core` nesmí importovat nic z `platform` ani `ui`.** Je testovatelné v Node.js a použitelné na serveru.
- **Nic se neodesílá.** Content-Security-Policy (`connect-src 'self'`) se vkládá při sestavení (`vite.config.ts`).
- **Data se nepřepisují.** Každý export je nová verze. Historie vzniká ze souborů ve složce.
- **Časy:** zobrazení v Europe/Prague. Termíny odvolávek jsou kalendářní data bez času.
- **Množství:** celá čísla v kusech, převod jednotek při načtení.
