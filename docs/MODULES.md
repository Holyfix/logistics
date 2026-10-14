# Moduly

Katalog modulů aplikace. V kódu: `src/ui/modules.ts` (seznam, skupiny, stav),
texty v `src/i18n/cs.ts` a `en.ts`. Úvodní stránka je rozcestník: každá skupina je karta
a moduly jsou v ní řádky; karty se skládají do sloupců. Až budou data, u každého modulu
se zobrazí hlavní číslo a stav.

## Přehled

Pořadí skupin na rozcestníku (karty se čtou shora dolů po sloupcích):

| Skupina | Modul | Otázka, na kterou odpovídá | Stav |
|---|---|---|---|
| Přehledy | **Dashboard** | Co je dnes potřeba řešit? | Fáze 6 |
| Přehledy | **KPI** | Jak se nám daří v čase? | Fáze 8 |
| Zákazníci | **Call-offs** | Co zákazníci chtějí a jak se to mění? | Fáze 3, aktuální odvolávky hotové |
| Zákazníci | **Coverage** | Vystačí díly u zákazníka? Pokrytí na jednotlivé dny | Fáze 4 (probíhá) |
| Zákazníci | **Expedice a dodávky** (OTD outbound) | Dodáváme zákazníkům včas? | Později |
| Zákazníci | **Mimořádné přepravy** | Kolik stojí mimořádné přepravy a proč vznikají? | Později |
| Materiál a sklad | **Komponenty** | Máme materiál na výrobu? | Fáze 4 (probíhá) |
| Materiál a sklad | **Zásoby** | Nemáme zásob moc nebo málo? | Fáze 9 |
| Materiál a sklad | **Obaly** | Na kolik dílů a dní vystačí obaly? | Fáze 5 |
| Výroba | **Plánování** | Co a kdy vyrobit na linkách, aby byl zákazník pokrytý? | Fáze 7 (probíhá), montáž hotová |
| Dodavatelé | **Příjem** | Co má dnes a zítra přijet a co je po termínu? | Fáze 9 |
| Dodavatelé | **Dodavatelé** (OTD inbound) | Dodávají nám dodavatelé včas? | Později |
| Řízení | **Akční plán** | Kdo co řeší a do kdy? | Později, upřesní se |
| Řízení | **Reporty** | Týdenní souhrn pro vedení | Později |
| Systém | **Data** | Jaká data jsou načtená a jsou v pořádku? | Hotové |
| Systém | **Nastavení** | Prahy, horizont, jméno pro zápisy | Později |

OTD inbound a outbound se dnes sledují v jiné aplikaci, proto jsou moduly Expedice
a Dodavatelé odložené. Modul Kapacity (odvolávky vs. kapacita linek) byl zvažován a vyřazen.

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
Hlavní údaj je **Discrete Qty** (požadavek na den), kumulativy jsou doplňková informace.
Filtry: zákazník, projekt, strana (LHD/RHD) z kmenových dat, hledání dílu.

- ✅ **Aktuální odvolávky:** nejnovější export po týdnech nebo dnech, nedodáno po termínu,
  změna proti předchozímu exportu (zvýraznění od 20 %), export do Excelu a CSV
- ⏳ **Přehled od začátku roku:** požadavek na každý týden z exportu téhož týdne, po dílech i celkem;
  odesláno z kumulativu jako doplňková informace
- ⏳ **Porovnání exportů:** dva libovolné exporty po týdnech a dílech, matice vývoje odvolávek
  (řádky = exporty, sloupce = týdny dodání)

### Coverage
- ✅ Pokrytí u zákazníka po dnech ze souborů zákazníka (každý zákazník jiný formát, sjednotí se)
- ✅ Přičtení transitu, filtry záporné kdykoli / ke zvolenému dni, závod, projekt, varianta, hledání
- ✅ Souhrn po variantách, export do Excelu a CSV, na rozcestníku chybějící kusy v prvních 2 dnech bez transitu a s transitem
- ✅ Náš sklad ze souboru Stock (celý sklad po lokacích, sdílený s dalšími moduly)
- ⏳ Dodatečný transit z naší expedice
- ✅ Tři formáty souborů zákazníka (Coverage Report Overview, Articles, Bestand); transit se sjednotí

### Mimořádné přepravy
- Zápis mimořádné přepravy přímo v aplikaci (do sdílené složky)
- Příčina, náklad, odpovědnost; vývoj počtu a nákladů v čase

### Komponenty
- ✅ Rozpad přes víceúrovňový kusovník, komponenty vybrané v Item Mappingu
- ✅ Horizont 14 dní; potřeba výroby hotových dílů po dnech, na rozcestníku počet druhů komponent nepokrytých na 2 dny
- ✅ Pokrytí komponent podle odvolávek a našeho skladu komponent (volitelně po odečtu našeho skladu hotových dílů a mezivýroby); „Pokryto do“ (první chybějící komponenta), potřeba 7 dní, zásoba ve dnech výroby
- ✅ „Zákazník pokryt do“ (rámeček): do kdy pokryjeme zákazníka podle coverage (jeho sklad + transit) naším skladem hotových dílů, mezivýrobou a výrobou z komponenty; pod datem pokrytí jen hotovými díly
- ✅ Poptávka hotových dílů se řídí filtrem komponent (projekt, vybraná komponenta → hotové díly, které ji mají v kusovníku)
- ⏳ Otevřené nákupní objednávky (pokud jsou v exportu)
- Shortage list pro ranní poradu

### Zásoby
- Zásoba ve dnech spotřeby
- Díly nad maximem a pod minimem, ležáky bez pohybu
- Zdroj: export zásob a pohybů z ERP

### Plánování
- Karty: **Přehled** · **ASSEMBLY** · **FOA** · **SLH** · **IMM** · **Kapacity**
- Přehled: pro každou linku a projekt chybějící kusy podle coverage, plán a vytížení na dnes a zítra, díly s chybějícími kusy, pokryto s plánem do, stav uložení
- ASSEMBLY (montáž): plán po směnách (díly × směny) na zbývající směny dneška a zítřek pro každý projekt; návrh plánu
  kryje první chybějící dny podle coverage (sklad a transit u zákazníka + náš sklad) v rámci kapacity; ruční úpravy,
  kapacita směn, pořadí stran (LHD a RHD nikdy zároveň), odeslání po termínu
- Kapacity: kusů za směnu a směny po–pá pro linku a projekt, začátek směn, doprava podle destinace (pokrytí u zákazníka, transit, příjezd)
- Plán se ukládá jako Excel do složky `Plan` (soubor na linku a projekt), dá se sdílet a aplikace ho zase načte
- Později: FOA, SLH a IMM navázané na plán montáže přes kusovník, plán vs. skutečnost a prostoje (z MES)

### Obaly
- **Zápis:** každé ráno se zapíše počet obalů podle inventury (po typech obalů)
- **Výpočet:** počet obalů × počet dílů v obalu = kolik dílů lze zabalit. Porovnáním s odvolávkami vyjde, na kolik dní obaly vystačí.
- Vývoj stavu obalů v čase
- Potřebná kmenová data: typ obalu, které díly do něj patří a kolik kusů se do něj vejde

### Příjem
- Očekávané dodávky na dnes a zítra, dodávky po termínu
- Vazba na shortage list komponent
- Zdroj: otevřené nákupní objednávky z ERP

### Reporty
- Týdenní souhrn z ostatních modulů, export do PDF a Excelu

### Data
- Výběr sdílené složky, stav načtených exportů, chyby v datech

### Nastavení
- Prahy semaforu, horizont výhledu
- Jméno uživatele pro zápisy (obaly, později akční plán)

## Zápis dat

Moduly Obaly a později Mimořádné přepravy a Akční plán do aplikace zapisují. Bez serveru se záznamy ukládají
jako malé samostatné soubory do sdílené složky (návrh v [ADR 0003](adr/0003-zapis-do-sdilene-slozky.md)).
