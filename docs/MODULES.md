# Moduly

Katalog modulů aplikace. V kódu: `src/ui/modules.ts` (seznam, skupiny, stav),
texty v `src/i18n/cs.ts` a `en.ts`. Úvodní stránka je rozcestník s dlaždicemi.
Až budou data, dlaždice ukážou hlavní číslo a stav (varianta B z návrhu).

## Přehled

| Skupina | Modul | Otázka, na kterou odpovídá | Stav |
|---|---|---|---|
| Přehledy | **Dashboard** | Co je dnes potřeba řešit? | Fáze 6 |
| Přehledy | **KPI** | Jak se nám daří v čase? | Fáze 8 |
| Zákazníci | **Call-offs** | Co zákazníci chtějí a jak se to mění? | Fáze 3 |
| Zákazníci | **Expedice a dodávky** (OTD outbound) | Dodáváme zákazníkům včas? | Později |
| Materiál | **Coverage** | Vystačí hotové výrobky na odvolávky? | Fáze 4 |
| Materiál | **Komponenty** | Máme materiál na výrobu? | Fáze 4 |
| Výroba a obaly | **Plánování** (plnění plánu a prostoje) | Vyrobili jsme, co jsme měli? Proč ne? | Fáze 7 |
| Výroba a obaly | **Obaly** | Na kolik dílů a dní vystačí obaly? | Fáze 5 |
| Dodavatelé a řízení | **Dodavatelé** (OTD inbound) | Dodávají nám dodavatelé včas? | Později |
| Dodavatelé a řízení | **Akční plán** | Kdo co řeší a do kdy? | Později, upřesní se |
| Systém | **Data** | Jaká data jsou načtená a jsou v pořádku? | Fáze 2 |
| Systém | **Nastavení** | Prahy, horizont, jméno pro zápisy | Fáze 2 |

OTD inbound a outbound se dnes sledují v jiné aplikaci, proto jsou moduly Expedice
a Dodavatelé odložené.

## Funkce modulů

### Dashboard
- Kritické díly a komponenty
- Významné změny v odvolávkách za posledních 24 hodin
- Plnění plánu a prostoje za včerejšek
- Na kolik dní vystačí obaly
- Čerstvost načtených dat

### KPI
- Vývoj ukazatelů po týdnech a měsících, cílové hodnoty a trend
- Návrh sady: stabilita odvolávek, plnění plánu (%), prostoje celkem a kvůli materiálu (h),
  počet kritických dílů, průměrné pokrytí ve dnech
- Smysl dává, až budou data za několik týdnů

### Call-offs
- Porovnání aktuální a předchozí verze odvolávky po dnech a týdnech
- Změny v závazném horizontu a nad nastavitelným prahem, nové a zrušené termíny
- Poptávka po týdnech podle zákazníků
- Otevřená otázka: kontrola kumulativu jako jeden sloupec (samostatný modul není potřeba)

### Coverage
- Výhled zásob hotových výrobků na 14 dní, pokrytí ve dnech, semafor
- Datum, kdy díl dojde

### Komponenty
- Rozpad poptávky přes kusovník, pokrytí nakupovaných komponent
- Otevřené nákupní objednávky (pokud jsou v exportu)
- Shortage list pro ranní poradu

### Plánování (plnění plánu a prostoje)
- Plán vs. skutečnost po dnech, směnách a linkách
- Prostoje podle příčin (Pareto), zvlášť prostoje kvůli chybějícímu materiálu
- Zdroj: exporty z MES (upřesní se, zda obsahují příčiny prostojů)
- Aktivní plánování s Ganttovým diagramem zatím není v plánu (vyžadovalo by server)

### Obaly
- **Zápis:** každé ráno se zapíše počet obalů podle inventury (po typech obalů)
- **Výpočet:** počet obalů × počet dílů v obalu = kolik dílů lze zabalit. Porovnáním s odvolávkami vyjde, na kolik dní obaly vystačí.
- Vývoj stavu obalů v čase
- Potřebná kmenová data: typ obalu, které díly do něj patří a kolik kusů se do něj vejde

### Data
- Výběr sdílené složky, stav načtených exportů, chyby v datech

### Nastavení
- Prahy semaforu, horizont výhledu
- Jméno uživatele pro zápisy (obaly, později akční plán)

## Zápis dat

Moduly Obaly a později Akční plán do aplikace zapisují. Bez serveru se záznamy ukládají
jako malé samostatné soubory do sdílené složky (návrh v [ADR 0003](adr/0003-zapis-do-sdilene-slozky.md)).
