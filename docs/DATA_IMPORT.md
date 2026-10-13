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

Doporučená struktura (složka se v aplikaci vybírá celá, podsložky se prohledají):

```
Logistics/
├── Item_Mapping.xlsx     mapování dílů (kmenová data)
├── Call-offs/            týdenní exporty odvolávek (název souboru s týdnem, např. CW42)
├── Coverage/<destinace>/<projekt>/   soubory pokrytí od zákazníka
├── Zásoby/               později: náš sklad pro Coverage, Komponenty, Zásoby
├── Kusovník/             později: Komponenty
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
| Order Multiple | Balení, Kusů v balení (pro náš sklad v Coverage) | ne |

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

- **Pokrytí na konci dne** = sklad u zákazníka − poptávka od prvního dne do daného dne;
  s volbou „Přičíst transit“ + transit, který do daného dne dorazí. Konečný stav dne ze souboru
  se nepoužívá, protože je to vzorec s přepínačem transitu.
- Dny, které soubor nemá (víkend), převezmou poslední známý stav; dny za horizontem souboru jsou prázdné.
- Sloupce s datem bez jediné hodnoty (např. staré dny v šabloně zákazníka) se vynechají.
- Pomocné řádky bez čísla dílu zákazníka (např. blok kumulované poptávky pod daty) se přeskočí.
- Další formáty zákazníka, náš sklad a dodatečný transit (naše expedice) se doplní postupně.

## Testovací data

`sample-data/` obsahuje smyšlené exporty, mapování a soubor coverage ve stejném formátu
(`node scripts/generate-sample-data.mjs`). Skutečné exporty do repozitáře nepatří.
