# Načítání dat

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

Doporučená struktura (složka se v aplikaci vybírá celá, podsložky se prohledají):

```
Logistics/
├── Item_Mapping.xlsx     mapování dílů (kmenová data)
├── Call-offs/            týdenní exporty odvolávek (název souboru s týdnem, např. CW42)
├── Coverage/<destinace>/<projekt>/   soubory pokrytí od zákazníka
├── Stock_13.10.2026.csv  náš sklad (celý sklad po lokacích; Coverage, později Komponenty, Zásoby)
├── BOM/                  kusovníky z ERP (MBOM_<výrobek>.xlsx) pro modul Komponenty
├── Objednávky/           později: Příjem (otevřené nákupní objednávky)
├── Výroba/               později: Plánování (plnění plánu a prostoje)
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

Tabulku udržuje uživatel. Jeden řádek = jeden díl. V Excelu na prvním listu, záhlaví v prvním řádku.

| Sloupec | Alternativní názvy | Povinný |
|---|---|---|
| Item Number | Díl, Číslo dílu | ano |
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

Další sloupce (např. Yield Percent, Cost Total) aplikace ignoruje.

- Šablonu se všemi díly z aktuálního exportu odvolávek stáhnete v modulu Data.
- Díly bez kmenových dat lze v Call-offs vyfiltrovat volbou „Bez kmenových dat“.
- **Číslo zákazníka** se pro párování se soubory zákazníka sjednotí: velká písmena, bez mezer;
  dlouhá čísla začínající „A“ (15 a více znaků) se zkrátí na prvních 11 a posledních 4 znaků.
  Tím se shodnou zápisy `A1234567890  00009051`, `A1234567890      9051` i `A1234567890-9051`.

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

Export víceúrovňového kusovníku z ERP, jeden soubor na výrobek (např. `MBOM_<výrobek>.xlsx`). Načtou se všechny soubory;
když je hotový díl ve víc souborech, použije se nejnovější soubor.

| Sloupec | Další povolené názvy | Povinný |
|---|---|---|
| Level | Úroveň: „Parent“ = hotový díl, pak `1`, `.2`, `..3` … | ano |
| Component Item | Component, Komponenta | ano |
| Quantity Per | Qty Per, Množství (na 1 ks nadřazeného dílu) | ano |
| Description, UM, Purchase/Manufacture | Popis, MJ, P/M (P = nákup, L = výroba) | ne |

- **Množství na hotový díl** = součin „Quantity Per“ od hotového dílu dolů; stejná komponenta na víc místech se sečte.
  Rozpad je hrubý: zásoba mezivýrob se neodečítá. „Start Eff“ se nepoužívá.
- **Které komponenty se zobrazí:** ty, které mají v Item Mappingu ve sloupci „Component Coverage“ hodnotu „Ano“.
  Když sloupec v mappingu není, zobrazí se všechny nakupované komponenty (P). Mezivýroby tak lze vynechat.
- **Horizont** je 14 dní od dneška.
- **Poptávka hotového dílu na den** je z nejnovějšího exportu odvolávek (požadované množství na den, od dneška).
  Soubory pokrytí od zákazníka se pro komponenty nepoužívají: ukazují jen stav na konci dne, takže spotřebu
  prvního dne z nich nejde spolehlivě určit. Nedodáno po termínu (backlog) se nepřičítá.
- **Spotřeba komponenty** = poptávka hotových dílů × množství z kusovníku; **stav** = náš sklad (stejné lokace jako v Coverage)
  − kumulovaná spotřeba. Komponenta je v záporu ode dne, kdy stav klesne pod nulu.
- **Ø spotřeba / den výroby** = spotřeba za horizont ÷ počet pracovních dní (po–pá) v horizontu.
- **Vystačí** = na kolik dní výroby stačí samotná komponenta (sklad ÷ Ø spotřeba) a od kterého dne chybí.
  Hotové díly ani mezivýroba se tu neodečítají: je to údaj pro řízení komponent.
- **Zákazník pokryt do** (informace) = poslední pracovní den, kdy jsou odvolávky zákazníka pokryté, když se jako v MRP
  den po dni nejdřív spotřebuje sklad a transit u sekvencéru (ze souborů Coverage; transit podle dne příjezdu),
  pak naše hotové díly, mezivýroba (úroveň po úrovni) a teprve potom komponenta. Odvolávky zákazníka se zásobou
  sekvencéru nepočítají, proto se odečítá. Bez doby výroby a bez otevřených objednávek. U vyráběného dílu,
  pod kterým jsou v kusovníku další díly, se neurčuje („—“).
- Tabulka **Poptávka hotových dílů** ukazuje u každého hotového dílu sklad + transit u sekvencéru a náš sklad.

## Testovací data

`sample-data/` obsahuje smyšlené exporty, mapování, soubory coverage, sklad a kusovník ve stejném formátu
(`node scripts/generate-sample-data.mjs`). Skutečné exporty do repozitáře nepatří.
