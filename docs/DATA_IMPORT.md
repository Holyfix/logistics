# Načítání dat

Přehled, odkud se který údaj bere a jak jsou soubory navázané: [Mapa dat](DATA_MAP.md).

## Sdílená složka

Aplikace čte soubory ze sdílené složky (SharePoint/OneDrive synchronizovaný do počítače).
V Edge a Chrome si složku zapamatuje, v ostatních prohlížečích se vybírá při každém otevření.
Soubory se rozpoznají podle názvu (nezáleží na velikosti písmen ani diakritice):

| Soubor | Jak ho aplikace pozná | Formát |
|---|---|---|
| Export odvolávek | název obsahuje „Odvolávky“ / „call-off“, nebo leží ve složce `odvolavky` / `call-offs` | CSV (doporučeno) nebo XLSX |
| Mapování dílů (kmenová data) | název obsahuje „mapping“ / „kmenová“ / „master“ | XLSX nebo CSV |
| Pokrytí od zákazníka (Coverage) | leží ve složce `Coverage` (i v podsložkách) | XLSX / XLSM |
| Náš sklad (Stock) | název začíná „Stock“ / „Sklad“, nebo leží ve složce `Stock` / `Sklad` | CSV nebo XLSX |
| Kusovník (BOM) | název začíná „MBOM“ / „BOM“ / „Kusovník“, nebo leží ve složce `BOM` / `Kusovník` | XLSX nebo CSV |
| Plánování: kapacity a plány linek | leží ve složce `Plan` (nebo `Plán`); `Kapacity.xlsx` = kapacity, ostatní = plány | XLSX (zapisuje aplikace) |
| OIL (Open Issue List) | leží ve složce `OIL`, nebo název začíná „OIL“; platí nejnovější soubor | XLSX (zapisuje aplikace) |

Doporučená struktura (složka se v aplikaci vybírá celá, podsložky se prohledají):

```
Logistics/
├── Item_Mapping.xlsx     mapování dílů (kmenová data)
├── Call-offs/            týdenní exporty odvolávek (název souboru s týdnem, např. CW42)
├── Coverage/<destinace>/<projekt>/   soubory pokrytí od zákazníka
├── Stock_13.10.2026.csv  náš sklad (celý sklad po lokacích; Coverage, později Komponenty, Zásoby)
├── BOM/                  kusovníky z ERP (MBOM_<výrobek>.xlsx) pro modul Komponenty
├── Objednávky/           později: Příjem (otevřené nákupní objednávky)
├── Plan/                 Plánování: Kapacity.xlsx a plány linek (ASSEMBLY_<projekt>.xlsx), zapisuje aplikace
├── OIL/                  OIL.xlsx (Open Issue List), zapisuje aplikace
└── Obaly/                později: Obaly
```

Složky pro další moduly jsou návrh, upřesní se při jejich vývoji. Soubory, které aplikace nezná, ignoruje.

- **Týden exportu** se bere z názvu souboru (`CW42`, `KW 42`), jinak z prvního data v exportu.
  Pokud se liší, aplikace upozorní. Rok je z prvního data v exportu.
- **Staré exporty nemazat:** z nich vzniká přehled od začátku roku a porovnání.
- Víc souborů pro stejný týden: použije se naposledy změněný, ostatní se vypíšou v modulu Data.
- Zpracované exporty si prohlížeč uloží (IndexedDB). Znovu se čtou jen nové nebo změněné soubory.

## Export odvolávek

Týdenní export požadavků na expedici z ERP, horizont podle dat od zákazníka.

| Sloupec | Použití | Povinný |
|---|---|---|
| Item Number | číslo dílu | ano |
| Date | den požadavku (`DD.MM.YYYY`) | ano |
| Discrete Qty | **požadavek na daný den, hlavní údaj** | ano |
| Item Description | popis dílu | ne |
| Cumulative Qty, Cum Shipped | kumulativy, doplňková informace (nedodáno po termínu, odesláno po týdnech) | ne |
| Sales Order, Line, Ship-To | rozlišení plánů pro kumulativy | ne |

- Řádky se stejným dílem a dnem (různá odběrná místa, zakázky, reference) se sečtou.
- **Po termínu** = kumulativ požadovaný před prvním dnem exportu minus odesláno, za každý plán zvlášť,
  sečteno za díl (záporné hodnoty se nepočítají).
- **Excel od začátku roku** (tlačítko v Call-offs): požadavek týdne je vždy z exportu daného týdne (chybí-li, z posledního
  staršího exportu). **Odesláno** v týdnu = Cum Shipped v exportu následujícího týdne minus Cum Shipped
  v exportu týdne. Proto je potřeba ukládat do složky každý týdenní export; pokles kumulativu
  (vynulování) se jako odeslané množství nepočítá.
  Za posledním exportem navazuje výhled z aktuálního exportu do konce roku.
- CSV: UTF-8 (s BOM i bez) nebo Windows-1250, oddělovač `,` / `;` / tabulátor (rozpozná se),
  čísla `1 905,0` / `1905.0`.
- Excel (XLSX) se čte zhruba 30× pomaleji než CSV, proto je CSV doporučené.

## Mapování dílů (kmenová data)

Tabulku udržuje uživatel. Jeden řádek = jeden díl. V Excelu na prvním listu, záhlaví v prvním řádku – nebo po
druzích dílu na listech `FG`, `SFG`, `PG` (jako šablona): druh dílu pak určuje název listu (sloupec Item Type,
pokud ho list má a je vyplněný, má přednost). Ze sešitu s listy druhů se čtou listy druhů (a případně listy se
sloupcem Item Type); ostatní listy (Návod) se vynechají. Díl na dvou listech je duplicita.

| Sloupec | Alternativní názvy | Povinný |
|---|---|---|
| Item Number | Díl, Číslo dílu | ano |
| Item Type | Druh dílu, Druh | ne; `FG` hotový výrobek, `SFG` mezivýroba (WIP, přijme i „WIP“), `PG` nakupovaný díl; podle něj Kontrola mapování určí, co má být u dílu vyplněné |
| Customer Number | Číslo zákazníka | pro Coverage |
| Description | Item Description, Popis | ne |
| Variant | Varianta (např. `LHD`, `LHD HUD`, `RHD`) | ne |
| Type | Typ | ne |
| Project | Projekt | ne |
| Zákazník | Customer | ne |
| Strana | Side, Řízení; jinak se odvodí ze začátku varianty | ne |
| Safety Stock, Safety Time | Pojistná zásoba, Pojistná doba | ne |
| Order Multiple | Balení, Kusů v balení | ne |
| Component Coverage | Coverage Component, Komponenta | ne; „Ano“ (nebo Y, X, 1) = komponenta se sleduje v modulu Komponenty |
| Line | Linka, Výrobní linka | ne; linka, na které se díl vyrábí: `ASSEMBLY`, `FOA`, `SLH`, `IMM` (přijme i Montáž, Assy, Foaming, Slush, Vstřikování) |
| Category | Kategorie | ne; druh dílu nebo komponenty podle vlastní volby (např. `DP` = door panel, `HB`); filtr Kategorie v Call-offs, Coverage a Komponentách |

Další sloupce (např. Yield Percent, Cost Total) aplikace ignoruje.

- **Šablonu mapování** stáhnete v modulu Data. Má jen listy **FG**, **SFG**, **PG** (a Návod), každý jen se
  sloupci, které aplikace pro daný druh používá: FG (Item Number, Customer Number, Description, Project, Customer,
  Side, Variant, Category, Line, Order Multiple), SFG (Item Number, Description, Project, Line), PG (Item Number,
  Description, Category, Component Coverage). Díly bez druhu se zařadí podle údajů (Component Coverage = Ano → PG,
  linka FOA / SLH / IMM → SFG, ostatní → FG), díly, které v mapování chybí (z Coverage, odvolávek a kusovníků),
  jsou na listu FG; po nahrání mají díly druh podle listu. Chybějící údaj zůstane prázdný (co doplnit, ukazuje
  Kontrola mapování). Formátování je jen záhlaví (tmavé = povinný sloupec, světlé = volitelný), aby byl soubor
  rychlý. Sloupce, které aplikace nepoužívá (Type, Safety Stock, Safety Time), šablona neobsahuje. Soubor uložte
  jako Item_Mapping.xlsx.
- Díly bez kmenových dat lze v Call-offs vyfiltrovat volbou „Bez kmenových dat“.
- **Číslo zákazníka** se pro párování se soubory zákazníka sjednotí: velká písmena, bez mezer;
  u dlouhých čísel začínajících „A“ (15 a více znaků) se mezi prvními 11 a posledními 4 znaky vynechají
  doplňující nuly a pomlčky. Tím se shodnou zápisy `A1234567890  00009051`, `A1234567890      9051`
  i `A1234567890-9051`. Písmenné označení (aspoň 3 písmena, např. `ERS`) zůstane, ať je před variantou, nebo za ní:
  `A1234567890  ERS 8R01` = `A1234567890 8R01 ERS`, ale jiný díl než `A1234567890 8R01`.

## Pokrytí od zákazníka (Coverage)

Soubory se ukládají do `Coverage/<destinace>/<projekt>/`. Destinace a projekt se berou z názvů složek,
pro každou destinaci a projekt se použije naposledy změněný soubor (i z hlubší podsložky). Formát se pozná podle obsahu listu,
na názvu souboru nezáleží. Díly se párují s mapováním podle čísla zákazníka.

| Formát | Jak ho aplikace pozná | Co se z něj použije |
|---|---|---|
| Coverage Report Overview | list se záhlavím „Disposable Stock“ a „Stock End of the Day“, nad každým blokem dne datum | sklad „Stock in … 07:00“ minus „Open Orders“, poptávka (Demand) a transit (In Transit) po dnech |
| Articles | jedno záhlaví se sloupci „Customer Item“, „Stock“, „Stock in transit“ a dny („2026.10.13“) | stav dne **včetně transitu**; odečte se „Stock in transit“ + „Further stock in transit“. Díl se spáruje i podle „Item number“ (naše číslo dílu) |
| Bestand | záhlaví (do 10. řádku) se sloupci „ARTIKEL“, „SACHNUMMER“, „Bestand“ a dny jako datumy | stav dne **bez transitu**, transit = „Avisiert“; „Gesperrt“ se neodečítá. Použijí se jen řádky klienta z buňky „KLIENT:“ nad záhlavím |

- **Pokrytí na konci dne** = sklad u zákazníka − poptávka od prvního dne do daného dne;
  s volbou „Přičíst transit“ + transit, který do daného dne dorazí. Konečný stav dne ze souboru
  se nepoužívá, protože je to vzorec s přepínačem transitu.
- Dny, které soubor nemá (víkend), převezmou poslední známý stav; dny za horizontem souboru jsou prázdné.
- Sloupce s datem bez jediné hodnoty (např. staré dny v šabloně zákazníka) se vynechají.
- Pomocné řádky bez čísla dílu zákazníka (např. blok kumulované poptávky pod daty) se přeskočí.
- Stejný díl na víc řádcích jednoho souboru (druhý řádek bývá prázdný) se sečte do jednoho řádku.
- **Náš sklad** (sloupec „Náš sklad“, volba „Přičíst náš sklad“): zásoba dílu ze souboru skladu, přičte se ke všem dnům.
- Další formáty zákazníka a dodatečný transit (naše expedice) se doplní postupně.

## Náš sklad (Stock)

Export zásob po lokacích za celý sklad. Používá se nejnovější soubor (podle data změny), starší se vypíšou v modulu Data.
Soubor obsahuje celý sklad, takže ho mohou použít i další moduly (Komponenty, Zásoby).

| Sloupec | Další povolené názvy | Povinný |
|---|---|---|
| Item Number | Díl, Číslo dílu, Item | ano |
| Qty On Hand - Inv Detail | Qty Available (má přednost), Qty On Hand, Quantity, Množství | ano |
| Zone ID | Zone, Zóna | pro Coverage |
| Location | Lokace | pro vyloučení externích lokací |
| Status, Area ID, Warehouse ID, Description | | ne |

- Čísla v českém formátu (`"1 236,0"`) i anglickém se přečtou; řádek s neplatným množstvím se vypíše v modulu Data.
- **Pro Coverage** se sečtou kladná množství dílu na lokacích v zónách **INCOME, MEZ, PRE, PURCH, SALE a WRKC**;
  plná i neúplná balení dohromady (bez rozdělení podle Order Multiple). Ostatní zóny (např. karanténa, inventurní rozdíly)
  a záporné lokace se nepočítají.
- **Externí lokace**, kde jsou díly už zamontované ve výrobku odběratele, se nepočítají. Pravidlo je pevně
  v aplikaci (`src/core/stock.ts`); název lokace je firemní, proto je v kódu jen jako otisk (hash) a skutečný
  název ukáže modul Data v panelu „Náš sklad“ (řádek „Vyloučené lokace“). Další lokaci lze přidat jen úpravou aplikace.
- Díl se se skladem páruje přes mapování (Item Number), díl bez mapování sklad nemá.
- U Excelu se čte list „Data“, jinak první list.

## Kusovník (BOM) a modul Komponenty

Export víceúrovňového kusovníku z ERP, jeden soubor na výrobek (např. `MBOM_<výrobek>.xlsx`), nebo víc výrobků v jednom
souboru (i na víc listech). Načtou se všechny soubory a všechny listy; když je hotový díl ve víc souborech, použije se
nejnovější soubor. Soubor musí ležet ve složce `BOM` / `Kusovník`, nebo mít název začínající „MBOM“, „BOM“ či „Kusovník“.
Modul Data ukazuje u každého souboru počet hotových dílů a jejich projekty podle Item Mappingu; projekt pro filtr
v Komponentách se bere z Item Mappingu (sloupec Project u hotového dílu).

| Sloupec | Další povolené názvy | Povinný |
|---|---|---|
| Level | Úroveň: „Parent“ nebo `0` = hotový díl, pak `1`, `.2`, `..3` … | ano |
| Component Item | Component, Komponenta | ano |
| Quantity Per | Qty Per, Množství (na 1 ks nadřazeného dílu) | ano |
| Description, UM, Purchase/Manufacture | Popis, MJ, P/M nebo sloupec s „Purchased“ v názvu, např. „P = Purchased / L = Line manufactured“ (P = nákup, L = výroba) | ne |
| Project | Projekt; nepoužívá se – projekt je jen z Item Mappingu | ne |

- **Množství na hotový díl** = součin „Quantity Per“ od hotového dílu dolů; stejná komponenta na víc místech se sečte.
  Rozpad je hrubý: zásoba mezivýrob se neodečítá. „Start Eff“ se nepoužívá.
- **Které komponenty se zobrazí:** ty, které mají v Item Mappingu ve sloupci „Component Coverage“ hodnotu „Ano“.
  Když sloupec v mappingu není, nesleduje se žádná komponenta (Kontrola mapování na to upozorní).
- **Horizont** je 14 dní od dneška. Pokrytí komponent se počítá **podle odvolávek** (nejnovější export) a našeho
  skladu komponent: stav = náš sklad komponenty − kumulovaná spotřeba (odvolávky hotových dílů × kusovník).
- Přepínač **„Odečíst náš sklad hotových dílů a mezivýroby“** (výchozí vypnutý): odvolávky se nejdřív pokryjí naším
  skladem hotových dílů a mezivýroba svým skladem, komponenta se spotřebuje jen na zbytek (jako MRP, den po dni,
  bez doby výroby).
- Záporné číslo = kolik kusů komponenty chybí. **Pokryto do** = poslední den (i víkend) se stavem ≥ 0; další den je
  první den, kdy komponenta chybí („Nepokryto“, když chybí už dnes). Když vystačí na celých 14 dní, ukáže se poslední
  den horizontu s „a déle“.
- **Zákazník pokryt do** (rámeček v řádku dnů) = poslední den, kdy je zákazník pokrytý hotovými díly s komponentou:
  jeho sklad + transit podle coverage (za koncem souboru odvolávky po spotřebování zbytku, bez souboru odvolávky);
  se zaškrtnutím „Odečíst náš sklad…“ i náš sklad hotových dílů. Počítá se **každý hotový díl zvlášť**, ne součet
  za den: když u jednoho dílu chybí byť 1 ks, den už pokrytý není. U komponenty ve více hotových dílech platí
  nejdřívější. Datum = poslední den (i víkend, zákazník může mít víkendové směny) před prvním dnem, kdy díl chybí;
  „Nepokryto“, když chybí už dnes.
  Hotové díly bez souboru coverage se nepočítají (sklad a transit u zákazníka neznáme); když ho nemá žádný, ukáže se „—“.
- **Potřeba 7 dní** = potřeba komponenty za prvních 7 dní. **Zásoba (dní výroby)** = sklad komponenty ÷ průměrná
  denní spotřeba; spotřeba = odvolávky hotových dílů za prvních 7 dní × kusovník (bez odečtu našeho skladu hotových
  dílů), vydělená počtem pracovních dní po–pá v těchto 7 dnech. Příklad: odvolávky za 7 dní × kusovník = 1 000 ks
  komponenty, v 7 dnech je 5 pracovních dní → 200 ks za den; sklad 700 ks → zásoba 3,5 dne výroby.
- Tabulka **Odvolávky hotových dílů** ukazuje čistý požadavek zákazníka (odvolávky po dnech, bez odečtu našeho skladu),
  součet za 7 dní a jako poslední řádek součet dnů; řídí se filtry nad pokrytím komponent.
- Bez otevřených nákupních objednávek a bez doby výroby.

## Plánování (složka Plan)

Na rozdíl od ostatních dat soubory plánování **vytváří aplikace** tlačítkem Uložit v modulu Plánování.
Zapisují se do složky `Plan` ve vybrané sdílené složce (při prvním uložení prohlížeč požádá o povolení zápisu).
V prohlížeči bez přístupu ke složce se soubor stáhne a uloží se ručně.

| Soubor | Obsah |
|---|---|
| `Plan/Kapacity.xlsx` | list **Linky** (Linka, Projekt, Ks za směnu, Směny po–pá, např. `R O N`; starší sloupec Ks v balení se ignoruje), list **Destinace** (Destinace, Pokrytí u zákazníka (dny), Transit (h), Příjezd; zatím se v plánu nepoužívá), list **Směny** (Ranní směna od) |
| `Plan/<linka>_<projekt>.xlsx`, např. `ASSEMBLY_P100.xlsx` | list **Plán** (Linka, Projekt, Datum, Směna, Pořadí, Strana, Díl, Číslo zákazníka, Popis, Množství; jeden řádek = díl na směně v pořadí výroby), list **Přehled** (díly × směny, jen pro čtení), list **Kapacita směn** (Datum, Směna, Kapacita = ručně zadaná kapacita, Automaticky = `LHD`, `RHD` nebo `LHD+RHD` u směn s automatickým plánem) |

- Jeden soubor na linku a projekt: každou linku plánuje jeden člověk, takže se zápisy nepotkají.
  Když soubor mezitím změnil někdo jiný, aplikace se před přepsáním zeptá.
- **Díly montáže:** díly se souborem coverage, které mají v mapování Line = `ASSEMBLY`. Projekt, strana a balení
  jen z mapování (bez zálohy ze složky nebo popisu). Plán je po projektech.
- **Plán vypadá jako coverage:** u každého dílu vlevo kusy po směnách plánovacích dnů, vpravo coverage po dnech:
  stav u zákazníka na konci dne podle souboru coverage (jeho sklad + transit − jeho plán) + náš sklad hotového dílu
  (vždy) + **vše naplánované, přičtené do všech dnů** (první nepokrytý den −50 a v plánu 60 ks → 10; kdy vyrobit,
  aby díly dorazily včas, řídí plánovač). Počítají se směny od dneška, starší výroba už je v našem skladu.
  Záporný stav = zákazník nepokrytý. Coverage se přepočítá s každým zapsaným číslem.
- **Pokryto do** = poslední den (i víkend) s coverage 0 nebo víc, s plánem i bez něj. „… a déle“ = pokryto celé
  období souboru coverage (nejvýš 28 dní, bez souboru 14 dní od dneška).
- **Plánovací dny:** výchozí dnes a zítra po směnách R, O, N (po 8 hodinách od začátku ranní směny); tlačítky − a +
  se přidávají nebo ubírají další dny. Den, ve kterém už je něco naplánované nebo automatická směna, ubrat nejde. Kapacita linky platí
  v pracovní dny pro vybrané směny, víkendy, svátky a přesčasy se zadávají v plánu.
- **Automatický plán:** u směny se zvolí strana (`LHD`, `RHD` nebo obě) a směna se naplánuje sama a přepočítává se
  s každou změnou. Strana dílu se bere podle začátku (`RHD HUD` = RHD, `LHD HUD` = LHD). Chybějící kusy = přírůstek
  nejhlubšího záporného stavu coverage bez plánu po dnech; náš sklad a ruční směny pokryjí nejdřívější z nich.
  Automatické směny se plní v pořadí směn: vždy díl zvolené strany s nejdřívějším nepokrytým dnem (při shodě díl
  ze strany, která se právě vyrábí), po celých dnech, dokud je kapacita. Přepsáním čísla nebo volbou „ručně“ se
  směna změní na ruční a dopočítaná čísla zůstanou. Do souboru se ukládají i dopočítaná množství. Na směně se díly
  řadí po stranách (LHD a RHD nikdy zároveň); pořadí „LHD → RHD“ = nejdřív LHD, pak přestavba na RHD. Směna začíná
  stranou, kterou skončila předchozí směna (ruční i automatická), jinak LHD; podle toho se rozhoduje i shoda dne
  u volby obě strany.
- **Balení:** kusy se plánují po celých baleních podle Order Multiple z mapování; díl bez balení se nezaokrouhluje.
  Automatický plán zaokrouhluje nahoru (kusy navíc pokryjí další dny) a do kapacity směny dá jen celá balení;
  ručně jde zadat libovolné číslo.
- **Vymazat směnu:** tlačítko ↺ nad směnou vymaže její kusy i automatický plán (kapacita směny zůstane).
  Plánovat jde každou směnu, i běžící nebo proběhlou (je jen podbarvená).

## OIL (složka OIL)

Soubor `OIL/OIL.xlsx` **vytváří aplikace** tlačítkem Uložit v modulu OIL (při prvním uložení prohlížeč požádá
o povolení zápisu; bez přístupu ke složce se soubor stáhne). Když soubor mezitím změnil někdo jiný, aplikace se
před přepsáním zeptá; jeho změny by se přepsáním ztratily.

| List | Obsah |
|---|---|
| **OIL** | Číslo, Problém, Opatření, Odpovědný, Otevřeno, Termín, Původní termín, Posunů termínu, Plnění (%), Stav, Uzavřeno, Poslední komentář |
| **Komentáře** | Číslo, Kdy, Kdo, Komentář |
| **Posuny termínu** | Číslo, Kdy, Kdo, Z, Na, Důvod |

- **Plnění** po krocích 0, 25, 50, 75, 100 % = zapsáno, problém popsán, opatření určeno, opatření zavedeno, účinnost ověřena (kritéria v modulu OIL); 100 % bod uzavře (den uzavření).
- **Stav** se počítá: Hotovo (100 %), Zrušeno, Po termínu (termín v minulosti), Rozpracováno (25–75 %),
  Nezahájeno (0 %). V souboru je jen pro čtení; zpět se čte jen „Zrušeno“.
- **Posun termínu:** první termín se jen nastaví, každá další změna je posun s povinným důvodem, kdo a kdy;
  Původní termín a Posunů termínu jsou z historie.
- **Kdo:** jméno, které si uživatel vyplní v modulu OIL (pamatuje si ho prohlížeč).
- **Převod jiného OIL:** stačí sešit s listem, který má aspoň sloupce Číslo, Problém, Termín a Plnění (%);
  ostatní sloupce a listy Komentáře a Posuny termínu jsou volitelné, sloupce navíc se ignorují. Datum jako datum Excelu nebo `dd.mm.rrrr`,
  plnění 0–100 (zaokrouhlí se na nejbližší krok). Uloží se pak do `OIL/OIL.xlsx`.
- **Smazat trvale** odstraní bod i s komentáři a posuny (po potvrzení, do souboru se zapíše uložením). Zrušený
  bod naopak v seznamu zůstává.

## Testovací data

`sample-data/` obsahuje smyšlené exporty, mapování, soubory coverage, sklad, kusovník a kapacity plánování ve stejném formátu
(`node scripts/generate-sample-data.mjs`). Skutečné exporty do repozitáře nepatří.
