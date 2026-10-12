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
- [x] Návrhy úvodní obrazovky (3 varianty, bloky W1–W9)
- [x] Rozcestník s dlaždicemi a katalog modulů ([MODULES.md](MODULES.md))
- [x] Rozhodnutí o provozu a jazyku (ADR 0001, 0002)
- [x] Anonymizace dokumentace pro veřejný repozitář

### Fáze 1: Základ aplikace ✅
- [x] Projekt Vite + React + TypeScript, ESLint, Vitest
- [x] Čeština a angličtina, světlý a tmavý režim
- [x] Content-Security-Policy, která zakazuje odesílání dat
- [x] Kontrola, že v repozitáři nejsou datové soubory
- [x] CI a automatické nasazení na GitHub Pages
- [x] Zveřejnění repozitáře a nasazení na https://holyfix.github.io/logistics/ ([DEPLOYMENT.md](DEPLOYMENT.md))

### Fáze 2: Načítání dat a nastavení
- Výběr sdílené složky a zapamatování přístupu
- Čtení CSV na pozadí, automatické rozpoznání kódování a oddělovače
- Kontrola dat a přehled chyb (modul Data)
- Ukládání zpracovaných dat v prohlížeči, zpracování jen nových souborů
- Zápis záznamů do sdílené složky ([ADR 0003](adr/0003-zapis-do-sdilene-slozky.md))
- Nastavení: prahy, horizont, jméno pro zápisy
- Kmenová data: díly, zákazníci, převod čísla dílu zákazníka na interní číslo
- **Potřeba:** ukázky CSV exportů z ERP

### Fáze 3: Call-offs
### Fáze 4: Coverage a Komponenty
### Fáze 5: Obaly
### Fáze 6: Dashboard
### Fáze 7: Plánování (plnění plánu a prostoje)
### Fáze 8: KPI
### Fáze 9: Příjem a Zásoby

Obsah modulů je v [MODULES.md](MODULES.md).

### Později
- Expedice a dodávky (OTD outbound), Dodavatelé (OTD inbound). Dnes se sledují v jiné aplikaci.
- Akční plán (upřesní se)
- Mimořádné přepravy, Reporty
- E-mailová upozornění, aktivní plánování s Ganttovým diagramem (vyžadují server)

## Otevřené otázky

1. **Exporty z ERP:** ukázky CSV odvolávek, zásob, expedic a kusovníku (pro fázi 2).
2. **Zápis dat:** potvrdit ADR 0003 (záznamy jako soubory ve sdílené složce).
3. **Obaly:** typy obalů, přiřazení dílů k obalům a počty kusů v obalu (odkud je vzít).
4. **MES:** obsahují exporty prostojů jejich příčiny?
5. **Call-offs:** kontrola kumulativu jako sloupec, ano/ne.
6. **TISAX:** konzultace s ISB před nasazením na skutečná data.
