# Moduly

Katalog modulů aplikace. V kódu: `src/ui/modules.ts` (seznam, skupiny, stav),
texty v `src/i18n/cs.ts` a `en.ts`. Úvodní stránka je rozcestník: každá skupina je karta
a moduly jsou v ní řádky; karty se skládají do sloupců. Až budou data, u každého modulu
se zobrazí hlavní číslo a stav.

## Přehled

Pořadí skupin na rozcestníku (karty se čtou shora dolů po sloupcích):

| Skupina | Modul | Otázka, na kterou odpovídá | Stav |
|---|---|---|---|
| Přehledy | **Dashboard** | Co je dnes potřeba řešit? | Fáze 6, první verze hotová |
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
| Řízení | **OIL** | Kdo co řeší a do kdy? | První verze hotová |
| Řízení | **Reporty** | Týdenní souhrn pro vedení | Později |
| Systém | **Data** | Jaká data jsou načtená a jsou v pořádku? | Hotové |
| Systém | **Nastavení** | Prahy, horizont, jméno pro zápisy | Později |

OTD inbound a outbound se dnes sledují v jiné aplikaci, proto jsou moduly Expedice
a Dodavatelé odložené. Modul Kapacity (odvolávky vs. kapacita linek) byl zvažován a vyřazen.

## Funkce modulů

### Dashboard
- **Karta za oblast** (Zákazník, Komponenty, OIL, Odvolávky, Data): barevný pruh podle nejhoršího stavu
  (červená hoří, žlutá pozor, zelená v pořádku), hlavní číslo, malé čítače a 4 nejnaléhavější položky na řádek;
  kliknutím do modulu. Nahoře souhrn: kolik oblastí hoří, pozor, v pořádku
- ✅ **Kritické díly u zákazníka** (coverage od dneška): hoří = chybí i s transitem dnes nebo zítra, pozor = dnes
  nebo zítra chybí jen bez transitu (čeká na transit), pro informaci = chybí s transitem později
- ✅ **Kritické komponenty** (podle odvolávek a našeho skladu): hoří = dojdou do 2 dnů, pozor = do 7 dnů,
  pro informaci = později v horizontu; u každé „zákazník pokryt do“
- ✅ **Změny v odvolávkách** (příštích 12 týdnů proti předchozímu exportu): pozor = nedodáno po termínu nebo změna
  o 50 % a víc, pro informaci = ostatní významné změny (od 20 %)
- ✅ **OIL: nejbližší termíny:** otevřené body, hoří = po termínu, pozor = termín do 7 dní, pro informaci = později
  nebo bez termínu; plnění, odpovědný a počet posunů
- ✅ **Čerstvost dat:** sklad a coverage starší než 24 hodin, odvolávky z minulého týdne nebo chybějící soubor
- ⏳ Plnění plánu a prostoje za včerejšek, na kolik dní vystačí obaly (až budou moduly)

### KPI
- Vývoj ukazatelů po týdnech a měsících, cílové hodnoty a trend
- Návrh sady: stabilita odvolávek, plnění plánu (%), prostoje celkem a kvůli materiálu (h),
  počet kritických dílů, průměrné pokrytí ve dnech
- Smysl dává, až budou data za několik týdnů

### Call-offs
Hlavní údaj je **Discrete Qty** (požadavek na den), kumulativy jsou doplňková informace.
Filtry: zákazník, projekt, strana (LHD/RHD), kategorie z kmenových dat, hledání dílu.
- ✅ **Přehled po projektech:** strom Projekt → Kategorie → Strana (sloupce Project, Category, Side v mapování) se součty po týdnech, nedodáno po termínu, celkem a změna proti předchozímu exportu; rozbalení po úrovních; Excel pro vedení (titulek s exportem, datem a filtry, barevné záhlaví s pondělky týdnů, oddělovače tisíců, změna v ks i v % zeleně/červeně, ukotvené záhlaví, list Přehled ve zvolené úrovni a list Díly se všemi díly) a CSV

- ✅ **Aktuální odvolávky:** nejnovější export po týdnech nebo dnech, nedodáno po termínu,
  změna proti předchozímu exportu (zvýraznění od 20 %), export do Excelu a CSV
- ⏳ **Přehled od začátku roku:** požadavek na každý týden z exportu téhož týdne, po dílech i celkem;
  odesláno z kumulativu jako doplňková informace
- ⏳ **Porovnání exportů:** dva libovolné exporty po týdnech a dílech, matice vývoje odvolávek
  (řádky = exporty, sloupce = týdny dodání)

### Coverage
- ✅ Pokrytí u zákazníka po dnech ze souborů zákazníka (každý zákazník jiný formát, sjednotí se)
- ✅ Přičtení transitu, filtry záporné kdykoli / ke zvolenému dni, závod, projekt, varianta, kategorie, hledání
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
- ✅ „Zákazník pokryt do“ (rámeček): poslední den, kdy je zákazník pokrytý hotovými díly (jeho sklad + transit podle coverage, se zaškrtnutím i náš sklad hotových dílů); každý hotový díl zvlášť
- ✅ Poptávka hotových dílů se řídí filtrem komponent (projekt, vybraná komponenta → hotové díly, které ji mají v kusovníku)
- ✅ Filtr Kategorie: komponenty dané kategorie (z mapování) a komponenty ve výrobcích dané kategorie; hotové díly podle jejich kategorie
- ⏳ Otevřené nákupní objednávky (pokud jsou v exportu)
- Shortage list pro ranní poradu

### Zásoby
- Zásoba ve dnech spotřeby
- Díly nad maximem a pod minimem, ležáky bez pohybu
- Zdroj: export zásob a pohybů z ERP

### Plánování
- Karty: **Přehled** · **ASSEMBLY** · **FOA** · **SLH** · **IMM** · **Kapacity**
- Přehled: pro každou linku a projekt nepokryté díly, pokryto do (s plánem a bez něj), naplánované kusy, stav uložení
- ASSEMBLY (montáž): plán jako zákaznická coverage pro každý projekt; u dílu vlevo kusy po směnách, vpravo coverage
  po dnech (stav u zákazníka + náš sklad + vše naplánované), která se s každým číslem přepočítá; plánovací dny se
  přidávají a ubírají (výchozí dnes a zítra); automatické směny podle zvolené strany (LHD, RHD, obě; HUD patří
  ke své straně) kryjí první nepokryté dny v rámci kapacity; plán po celých baleních (Order Multiple, jinak 12);
  vymazání jednotlivé směny; ruční úpravy kterékoli směny, kapacita směn, pořadí stran
- Kapacity: kusů za směnu, směny po–pá a kusů v balení pro linku a projekt, začátek směn
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

### OIL (Open Issue List)
- ✅ Bod: číslo, oblast, téma, problém, příčina, opatření, odpovědný, otevřeno, termín, uzavřeno
- ✅ Zrušení bodu (zůstane v seznamu) a trvalé smazání s potvrzením
- ✅ Plnění po krocích 0/25/50/75/100 % kliknutím na kolečko (Harvey ball), přesně v detailu bodu
- ✅ Barva podle stavu: červená po termínu, žlutá rozpracováno, modrá nezahájeno, zelená hotovo, šedá zrušeno
- ✅ Posun termínu s povinným důvodem: u bodu „posunuto N×“, původní termín a historie (kdo, kdy, z – na, proč)
- ✅ Komentáře s datem a autorem
- ✅ Filtry Otevřené / Po termínu / Hotové / Vše, odpovědný, oblast, hledání; ukazatele otevřené, po termínu, hotovo, posuny
- ✅ Uložení do `OIL/OIL.xlsx` ve sdílené složce (listy OIL, Komentáře, Posuny termínu)
- ⏳ Živá společná editace (po přechodu na Firebase)

### Nastavení
- Prahy semaforu, horizont výhledu
- Jméno uživatele pro zápisy (obaly; OIL ho už má ve svém modulu)

## Zápis dat

Plánování a OIL už do sdílené složky zapisují (`Plan/`, `OIL/OIL.xlsx`); Obaly a později Mimořádné přepravy přibudou. Bez serveru se záznamy ukládají
jako malé samostatné soubory do sdílené složky (návrh v [ADR 0003](adr/0003-zapis-do-sdilene-slozky.md)).
