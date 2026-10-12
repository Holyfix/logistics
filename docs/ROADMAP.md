# Roadmapa

## Výchozí stav

| Téma | Rozhodnutí |
|---|---|
| Typ firmy | Dodavatel dílů do automotive |
| Rozsah | 1 závod, 1 sklad, ~20 uživatelů |
| Objemy | ~3 000 čísel dílů, ~30 příjmů a ~30 expedic denně |
| Zákazníci | 3 výrobci automobilů (v dokumentaci „zákazník A, B, C“) |
| Zdrojové systémy | ERP (exporty CSV), MES, Excel |
| Odvolávky | Export z ERP do CSV, ~60 000 řádků na export |
| Coverage | Hotové výrobky i nakupované komponenty (kusovník z ERP) |
| Plán výroby, data z MES | Později |
| Šarže, skenování, tisk štítků | Ne |
| Jazyky | Čeština, angličtina |
| Provoz | Aplikace v prohlížeči na GitHub Pages, data ve firemní sdílené složce ([ADR 0001](adr/0001-aplikace-v-prohlizeci.md)) |
| Jazyk vývoje | TypeScript ([ADR 0002](adr/0002-typescript.md)) |

**Princip:** aplikace nenahrazuje ERP ani MES. Čte jejich exporty a počítá z nich
přehledy, porovnání a varování. Nejdřív jen čtení a vyhodnocení, později i pracovní
funkce (plánování).

## Fáze

### Fáze 0: Analýza ✅
- [x] Požadavky a rozsah
- [x] Návrhy úvodní obrazovky (3 varianty, bloky W1–W9). Finální podoba se doladí později.
- [x] Rozhodnutí o provozu a jazyku (ADR 0001, 0002)
- [x] Anonymizace dokumentace pro veřejný repozitář

### Fáze 1: Základ aplikace ✅
- [x] Projekt Vite + React + TypeScript, ESLint, Vitest
- [x] Čeština a angličtina, světlý a tmavý režim
- [x] Content-Security-Policy, která zakazuje odesílání dat
- [x] Kontrola, že v repozitáři nejsou datové soubory
- [x] CI a automatické nasazení na GitHub Pages
- [x] Zveřejnění repozitáře a nasazení na https://holyfix.github.io/logistics/ ([DEPLOYMENT.md](DEPLOYMENT.md))

### Fáze 2: Načítání dat
- Výběr sdílené složky a zapamatování přístupu
- Rozpoznání exportů podle názvu a sloupců, čtení CSV na pozadí (Web Worker)
- Kontrola dat a přehled chyb (chybějící sloupce, neznámé díly, nečíselná množství)
- Ukládání zpracovaných dat v prohlížeči (IndexedDB), zpracování jen nových souborů
- Kmenová data: díly, zákazníci, převod čísla dílu zákazníka na interní číslo
- **Potřeba:** ukázky CSV exportů z ERP (pár řádků s vymyšlenými hodnotami, skutečné názvy sloupců)

### Fáze 3: Odvolávky a jejich porovnání
- Porovnání aktuální a předchozí verze po dnech a týdnech, nové a zrušené termíny
- Zvýraznění změn v závazném horizontu a nad nastavitelným prahem
- Kontrola kumulativů (přijato zákazníkem vs. odesláno)

### Fáze 4: Material coverage
- Výhled zásob hotových výrobků na 14 dní, pokrytí ve dnech, semafor
- Komponenty přes kusovník, otevřené nákupní objednávky (pokud jsou v exportu)

### Fáze 5: Úvodní obrazovka
- Souhrn ze všech modulů podle zvolených bloků W1–W9

### Fáze 6: Plán výroby a MES
- Plán vs. skutečnost, zahrnutí plánované výroby do coverage

### Fáze 7: Plánování a Gantt
- Kapacity linek, plánovací tabule, Ganttův diagram
- Vyžaduje sdílenou editaci, tedy přechod na server (varianta 2 nebo 3 v [HOSTING.md](HOSTING.md))

### Fáze 8: Automatizace exportů
- Naplánované exporty z ERP přímo do sdílené složky, aby je nikdo nemusel ukládat ručně

## Otevřené otázky

1. **Exporty z ERP:** ukázky CSV odvolávek, zásob, expedic/kumulativů a kusovníku (potřeba pro fázi 2).
2. **Nákupní objednávky:** jsou v ERP otevřené nákupní objednávky s termínem dodání (pro coverage komponent)?
3. **TISAX:** konzultace s ISB před nasazením na skutečná data.
4. **Úvodní obrazovka:** výběr bloků W1–W9 (do fáze 5).
