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

### Fáze 2: Načítání dat ✅
- [x] Výběr sdílené složky (Edge/Chrome si ji pamatují, jinde jednorázový výběr)
- [x] Rozpoznání exportů podle názvu, čtení CSV i Excelu na pozadí, kódování UTF-8 / Windows-1250
- [x] Mezipaměť v prohlížeči, zpracují se jen nové soubory
- [x] Modul Data: stav exportů, chyby v datech, šablona kmenových dat
- [x] Kmenová data dílů (zákazník, projekt, strana LHD/RHD) z Excelu nebo CSV
- [ ] Zápis záznamů do sdílené složky (ADR 0003): odloženo, až bude potřeba (Obaly)

### Fáze 3: Call-offs (hotovo)
- [x] Aktuální odvolávky po týdnech a dnech, změny proti předchozímu exportu, export Excel/CSV
- [x] Excel od začátku roku pro reporting: souhrn po týdnech (požadováno, odesláno, rozdíl, plnění) a listy po dílech, s výhledem do konce roku
- [x] Porovnání exportů: dva libovolné exporty po týdnech a po dílech, matice vývoje (10 exportů × 10 týdnů), export Excel/CSV

### Fáze 4: Coverage a Komponenty (probíhá)
- [x] Mapování dílů ve formátu Item_Mapping (číslo zákazníka, varianta, typ, projekt) místo šablony kmenových dat
- [x] Coverage: formát Coverage Report Overview, pokrytí po dnech, přičtení transitu, záporné kdykoli / ke dni, souhrn po variantách, export
- [x] Coverage: formát Articles (stav včetně transitu, transit se odečte)
- [x] Coverage: formát Bestand (stav bez transitu, jen řádky klienta ze souboru)
- [x] Coverage: náš sklad ze souboru Stock (zóny SALE a PURCH, jedno číslo bez rozdělení balení)
- [ ] Coverage: dodatečný transit z naší expedice
- [ ] Komponenty
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

1. **Mapování dílů:** Item_Mapping (Item Number, Customer Number, Description, Variant, Type, Project); později balení pro sklad.
2. **Další exporty z ERP:** zásoby, expedice, kusovník (pro fázi 4).
3. **Obaly:** typy obalů, přiřazení dílů k obalům a počty kusů v obalu (odkud je vzít).
4. **MES:** obsahují exporty prostojů jejich příčiny?
5. **Call-offs:** kontrola kumulativu jako sloupec, ano/ne.
6. **TISAX:** konzultace s ISB před nasazením na skutečná data.
