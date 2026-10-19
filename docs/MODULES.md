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
| Přehledy | **KPI** | Jak se nám daří v čase? (SQCDP) | Fáze 8 (probíhá), písmena a denní zápis hotové |
| Zákazníci | **Call-offs** | Co zákazníci chtějí a jak se to mění? | Fáze 3, aktuální odvolávky hotové |
| Zákazníci | **Coverage** | Vystačí díly u zákazníka? Pokrytí na jednotlivé dny | Fáze 4 (probíhá) |
| Zákazníci | **Expedice a dodávky** (OTD outbound) | Dodáváme zákazníkům včas? | Později |
| Zákazníci | **Mimořádné přepravy** | Kolik stojí mimořádné přepravy a proč vznikají? | Později |
| Materiál a sklad | **Komponenty** | Máme materiál na výrobu? | Fáze 4 (probíhá) |
| Materiál a sklad | **Zásoby** | Nemáme zásob moc nebo málo? | Fáze 9 (probíhá), přehled, díly a blokace hotové |
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
- ✅ **Na rozcestníku** u dlaždice Dashboard stejný souhrn: kolik oblastí hoří a kolik je pozor (stav oblastí po najetí myší)
- ✅ **Karta Data:** staré nebo chybějící soubory a počet dílů k doplnění v mapování (Kontrola mapování v modulu Data); žlutá, když něco chybí
- ✅ **Karta Zákazník = pokrytí po projektech:** za každý projekt ze souborů coverage od dneška do kdy je pokrytý
  (poslední den, kdy mají všechny díly zůstatek 0 a víc) a kolik dní – nejdřív bez transitu, pak s transitem;
  „+“ = celý horizont souboru. Červeně projekt pokrytý s transitem méně než 2 dny, žlutě jen bez transitu (čeká na
  transit). Hlavička karty vede do Coverage, klik na projekt otevře Coverage s filtrem projektu (`#coverage?project=…`)
- ✅ **Kritické díly u zákazníka** (coverage od dneška): hoří = chybí i s transitem dnes nebo zítra, pozor = dnes
  nebo zítra chybí jen bez transitu (čeká na transit), pro informaci = chybí s transitem později
- ✅ **Kritické komponenty** (podle odvolávek a našeho skladu): hoří = dojdou do 2 dnů, pozor = do 7 dnů,
  pro informaci = později v horizontu; u každé „zákazník pokryt do“
- ✅ **Změny v odvolávkách** (příštích 12 týdnů proti předchozímu exportu): pozor = změna o 50 % a víc, pro informaci = ostatní významné změny (od 20 %)
- ✅ **OIL: nejbližší termíny:** otevřené body, hoří = po termínu, pozor = termín do 7 dní, pro informaci = později
  nebo bez termínu; plnění, odpovědný a počet posunů
- ✅ **Čerstvost dat:** sklad a coverage starší než 24 hodin, odvolávky z minulého týdne nebo chybějící soubor
- ⏳ Plnění plánu a prostoje za včerejšek, na kolik dní vystačí obaly (až budou moduly)

### KPI (SQCDP)
- Čtyři karty: **Přehled** (písmena, grafy a opatření), **Zápis dne**, **Rozbor**, **Ukazatele a cíle**
- ✅ **Písmena S, Q, C, D, P** (bezpečnost, kvalita, náklady, dodávky, lidé) jako kalendář měsíce: každé políčko
  písmena je den. Barví se jen den: zelená v cíli, žlutá varování, červená za červenou hranicí, čárkovaný rámeček =
  pracovní den bez zápisu. Víkend je šedý, a když je zapsaný (někdy se pracuje), obarví se. Stav dne písmena = nejhorší
  z jeho ukazatelů
- ✅ **Pruh měsíců L–P** pod písmenem: barva měsíce podle podílu zelených dní ze zapsaných (90 % a víc zelená,
  75 % a víc žlutá, jinak červená); kliknutím se měsíc otevře
- ✅ **Den hodnoty** u každého ukazatele: **výsledek dne** (ruční, zapíše se ráno zpětně za uplynulý pracovní den) nebo
  **stav v den zápisu** (automatické: chybí u zákazníka, komponenty, OIL po termínu – patří k dnešku a obarví dnešní
  den). Ranní zápis má dvě části („Výsledky za Pá 16. 10.“ a „Stav Po 19. 10.“), jedno uložení zapíše každou ke svému
  dni. Automatické hodnoty se předvyplní jen pro dnešní stav; při úpravě staršího dne zůstanou prázdné
- ✅ **Zápis dne** (vlastní karta): tlačítko Zapsat nabídne nejstarší nezapsaný pracovní den za 30 dní, jinak předchozí
  pracovní den (v pondělí pátek; už zapsaný se zaškrtnutím „zapsáno ✓“ otevře zápis k úpravě), kliknutím
  na políčko v přehledu se otevře zápis jiného dne; nabídnou se i nezapsané pracovní dny za posledních 30 dní.
  Ukazatele s kategoriemi (S skoronehody, Q reklamace) mají pole pro každou kategorii (podklad pro Paretův graf).
  Stav se počítá už při psaní. Některé hodnoty aplikace předvyplní z dat (chybí u zákazníka z Coverage, kritické
  komponenty, body OIL po termínu); lze je přepsat
- ✅ **Ukazatele a cíle** se upravují v aplikaci: písmeno, název, jednotka, cíl, červená za, zda je lepší víc
  nebo méně, zdroj předvyplnění, kategorie
- ✅ Uložení do `KPI/KPI.xlsx` ve sdílené složce; na rozcestníku jsou písmena SQCDP obarvená podle předchozího pracovního dne (nezapsaný den = bez barvy)
- ✅ **Grafy pod písmeny:** pod S a Q Paretův graf kategorií za zobrazený měsíc nebo od začátku roku (součet
  událostí za kategorii, ukazatel bez kategorií svým součtem, např. úrazy; sloupce sestupně, kumulativní čára
  a hranice 80 %). Pod C, D a P všechny ukazatele písmene za posledních 7 zapsaných dní: řádek = ukazatel
  (s cílem a červenou hranicí), políčko = den s hodnotou obarvené podle stavu; klik otevře zápis dne.
  Popisek dne v písmenu vyjmenuje ukazatele, které den obarvily, s hodnotou
- ✅ **Opatření SQCDP** pod grafy: otevřené body OIL s písmenem (nejdřív po termínu, pak podle termínu); klik otevře
  bod v OIL. U každého písmene počet otevřených opatření
- ✅ **„+ OIL“ v Zápisu dne** u uloženého ukazatele mimo cíl (žlutá i červená): založí v OIL bod s písmenem,
  předvyplněným problémem (hodnota, den, cíl) a zdrojem (den a ukazatel) a otevře ho; existující body k ukazateli
  a dni jsou u ukazatele jako odkazy
- ✅ **Detail bodu mimo cíl** (nepovinný) v Zápisu dne pod ukazatelem: Projekt, Díl, Osoba (z OIL), Množství, Příčina
  (volný text s nabídkou dříve zapsaných příčin), víc řádků. Automatické ukazatele uloží detail samy (které díly,
  komponenty nebo body OIL hodnotu způsobily)
- ✅ **Rozbor:** body mimo cíl za posledních 7 dní, měsíc nebo vlastní období, filtr písmene a ukazatele. Nahoře „Opakuje
  se“ – projekty, díly, osoby a příčiny, které se objevily ve víc dnech, s odkazem na otevřené body OIL; pod tím souhrn
  po projektech, dílech, osobách a příčinách a seznam bodů s detaily (klik na den otevře zápis, export do Excelu)
### Call-offs
Hlavní údaj je **Discrete Qty** (požadavek na den), kumulativy jsou doplňková informace.
Filtry projekt, kategorie, strana (LHD/RHD) a varianta z kmenových dat se ovlivňují navzájem v libovolném pořadí (každý nabízí jen hodnoty odpovídající ostatním vybraným filtrům; strana a varianta jen tam, kde je díly mají), hledání dílu; díly bez projektu (bez mapování nebo s prázdným Project) jako volba „Bez projektu“ ve filtru Projekt.
- ✅ **Přehled po projektech:** strom Projekt → Kategorie → Strana → Varianta (sloupce Project, Category, Side, Variant v mapování; strana a varianta jen tam, kde je díly mají) se součty po týdnech, celkem a změna proti předchozímu exportu; rozbalení po úrovních; Excel pro vedení (titulek s exportem, datem a filtry, barevné záhlaví s pondělky týdnů, oddělovače tisíců, změna v ks i v % zeleně/červeně, ukotvené záhlaví, list Přehled ve zvolené úrovni a list Díly se všemi díly) a CSV

- ✅ **Aktuální odvolávky:** nejnovější export po týdnech nebo dnech,
  změna proti předchozímu exportu (zvýraznění od 20 %), export do Excelu a CSV
- ⏳ **Přehled od začátku roku:** požadavek na každý týden z exportu téhož týdne, po dílech i celkem;
  odesláno z kumulativu jako doplňková informace
- ⏳ **Porovnání exportů:** dva libovolné exporty po týdnech a dílech, matice vývoje odvolávek
  (řádky = exporty, sloupce = týdny dodání)

### Coverage
- ✅ Pokrytí u zákazníka po dnech ze souborů zákazníka (každý zákazník jiný formát, sjednotí se)
- ✅ Přičtení transitu, filtry záporné kdykoli / ke zvolenému dni; filtry destinace, projekt, kategorie, strana a varianta, které se ovlivňují navzájem v libovolném pořadí (strana a varianta jen tam, kde je díly mají), hledání; popis dílu jen z mapování (díl bez mapování s popisem ze souboru zákazníka)
- ✅ Souhrn po stranách (LHD / RHD), export do Excelu a CSV, na rozcestníku chybějící kusy v prvních 2 dnech bez transitu a s transitem
- ✅ Náš sklad ze souboru Stock (celý sklad po lokacích, sdílený s dalšími moduly)
- ⏳ Dodatečný transit z naší expedice
- ✅ Tři formáty souborů zákazníka (Coverage Report Overview, Articles, Bestand); transit se sjednotí
- ✅ **Doplněný transit** ze složky Transit (naše expedice, které soubor coverage ještě nemá): přičte se k transitu dílu;
  souhrn s podrobnostmi nad tabulkou, u dílu „+N expedice“; expedice ze dne před souborem coverage se nepřičte

### Mimořádné přepravy
- Zápis mimořádné přepravy přímo v aplikaci (do sdílené složky)
- Příčina, náklad, odpovědnost; vývoj počtu a nákladů v čase

### Komponenty
- ✅ Rozpad přes víceúrovňový kusovník, komponenty vybrané v Item Mappingu
- ✅ Horizont 14 dní; potřeba výroby hotových dílů po dnech, na rozcestníku počet druhů komponent nepokrytých na 2 dny
- ✅ Pokrytí komponent podle odvolávek a našeho skladu komponent (volitelně po odečtu našeho skladu hotových dílů a mezivýroby); „Pokryto do“ (první chybějící komponenta), potřeba 7 dní, zásoba ve dnech výroby
- ✅ „Zákazník pokryt do“ (rámeček): poslední den, kdy je zákazník pokrytý hotovými díly (jeho sklad + transit podle coverage, se zaškrtnutím i náš sklad hotových dílů); každý hotový díl zvlášť
- ✅ Poptávka hotových dílů se řídí filtrem komponent (projekt, vybraná komponenta → hotové díly, které ji mají v kusovníku)
- ✅ Filtry Projekt a Kategorie podle hotových dílů, navzájem v libovolném pořadí (kategorie jen z hotových dílů vybraného projektu, projekty jen s hotovými díly vybrané kategorie): komponenty v hotových dílech daného projektu a kategorie; hotové díly podle jejich projektu a kategorie
- ✅ Sledují se všechny nakupované díly (Item Type = PG); popis jen z mapování
- ⏳ Otevřené nákupní objednávky (pokud jsou v exportu)
- Shortage list pro ranní poradu

### Zásoby
- Karty: **Přehled** · **Díly** · **Blokace**; filtry druh (FG, SFG, PG, ostatní), projekt, kategorie, ABC a sklad
  (interní + externí, jen interní, jen externí)
- ✅ **Dosah zásoby** v pracovních dnech: kolik dní volná zásoba pokryje potřebu den po dni – FG z odvolávek, SFG a PG
  přes kusovník (odvolávky × množství na 1 ks hotového dílu, bez odečtu skladu hotových dílů jako v Komponentách)
- ✅ **Minimum** = potřeba na 5 pracovních dní, **maximum** = na 20 pracovních dní; kusy do minima a nad maximem
- ✅ **Pásma** (stejná pro všechny druhy): kritické pod 2 dny, nízké 2–5, v pořádku 5–20, vysoké 20–40, nadbytek nad 40
  nebo nad potřebu celého horizontu, bez potřeby v horizontu; díly mimo mapování „ostatní“ jen s hodnotou
- ✅ **Přehled:** hodnota zásob (z toho externí), kritické, pod minimem (za kolik doplnit), nadbytek (hodnota nad
  maximem), ležáky (bez pohybu 180+ dní), blokováno podle důvodu; rozložení podle dosahu pro FG, SFG a PG; struktura
  hodnoty (interní, externí, blokace); díly mimo pásmo v pořádku (klik ukáže lokace se statusem a posledním pohybem)
- ✅ **Díly:** všechny díly s filtrem pásma, hledáním a exportem do Excelu
- ✅ **Blokace:** blokovaná zásoba po lokacích podle hodnoty (QH a QH-TEMP kvalita, DIFF inventura, ClaimS-O logistika)
- ⏳ Karta Ležáky a bez potřeby, trend ze starších souborů Stock, ukazatel na rozcestníku a v Dashboardu
### Plánování
- Karty: **Přehled** · **ASSEMBLY** · **FOA** · **SLH** · **IMM** · **Kapacity**
- Přehled: pro každou linku a projekt nepokryté díly, pokryto do (s plánem a bez něj), naplánované kusy, stav uložení
- ASSEMBLY (montáž): plán jako zákaznická coverage pro každý projekt; u dílu vlevo kusy po směnách, vpravo coverage
  po dnech (stav u zákazníka + náš sklad + vše naplánované), která se s každým číslem přepočítá; plánovací dny se
  přidávají a ubírají (výchozí dnes a zítra); automatické směny podle zvolené strany (LHD, RHD, obě; HUD patří
  ke své straně) kryjí první nepokryté dny v rámci kapacity; plán po celých baleních (Order Multiple z mapování);
  vymazání jednotlivé směny; ruční úpravy kterékoli směny, kapacita směn, pořadí stran
- Kapacity: kusů za směnu a směny po–pá pro linku a projekt, začátek směn (balení je v mapování)
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
- ✅ Bod: číslo, problém, opatření, odpovědný, otevřeno, termín, uzavřeno
- ✅ Zrušení bodu (zůstane v seznamu) a trvalé smazání s potvrzením
- ✅ Plnění po krocích OIL (krok platí, až je celý splněný), barevná tlačítka:
  - 0 % zapsáno (šedá) – víme co, ale ještě ne proč
  - 25 % problém popsán (červená) – víme co, kde, jak velké a proč (u úkolu cíl)
  - 50 % opatření určeno (oranžová) – co, kdo, do kdy
  - 75 % opatření zavedeno (žlutá) – opatření je hotové
  - 100 % účinnost ověřena (zelená) – máme důkaz, že to funguje; bod se uzavře
  - v seznamu kolečko (Harvey ball) v barvě kroku, kliknutím o krok dál; v detailu pod tlačítky krátká
    vysvětlivka aktuálního kroku (pravidlo „krok platí, až je celý splněný“ po najetí myší)
- ✅ Pruh u řádku a štítek podle stavu: červená po termínu, žlutá rozpracováno, modrá nezahájeno, zelená hotovo, šedá zrušeno
- ✅ Posun termínu s povinným důvodem: u bodu „posunuto N×“, původní termín a historie (kdo, kdy, z – na, proč)
- ✅ Komentáře s datem a autorem, od nejstaršího po nejnovější; smazání křížkem po najetí myší (s potvrzením)
- ✅ Filtry Otevřené / Po termínu / Hotové / Vše, odpovědný (po osobách, bod „A / B“ patří k oběma), hledání; ukazatele otevřené, po termínu, hotovo, posuny
- ✅ **Písmeno SQCDP** (nepovinné): výběr v detailu bodu, sloupec a filtr v seznamu (i „bez písmene“); bod založený
  z KPI má písmeno, problém a zdroj předvyplněné a v detailu „z KPI · den · ukazatel“. Body s písmenem jsou v KPI
  jako Opatření SQCDP. Adresa `#oil?open=N` otevře bod N
- ✅ Uložení do `OIL/OIL.xlsx` ve sdílené složce (listy OIL, Komentáře, Posuny termínu)
- ⏳ Živá společná editace (po přechodu na Firebase)

### Nastavení
- Prahy semaforu, horizont výhledu
- Jméno uživatele pro zápisy (obaly; OIL ho už má ve svém modulu)

## Zápis dat

Plánování, OIL a KPI už do sdílené složky zapisují (`Plan/`, `OIL/OIL.xlsx`, `KPI/KPI.xlsx`); Obaly a později Mimořádné přepravy přibudou. Bez serveru se záznamy ukládají
jako malé samostatné soubory do sdílené složky (návrh v [ADR 0003](adr/0003-zapis-do-sdilene-slozky.md)).
