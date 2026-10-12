# Načítání dat

## Sdílená složka

Aplikace čte soubory ze sdílené složky (SharePoint/OneDrive synchronizovaný do počítače).
V Edge a Chrome si složku zapamatuje, v ostatních prohlížečích se vybírá při každém otevření.
Soubory se rozpoznají podle názvu (nezáleží na velikosti písmen ani diakritice):

| Soubor | Jak ho aplikace pozná | Formát |
|---|---|---|
| Export odvolávek | název obsahuje „Odvolávky“ / „call-off“, nebo leží ve složce `odvolavky` / `call-offs` | CSV (doporučeno) nebo XLSX |
| Kmenová data dílů | název obsahuje „kmenová“ / „master“ | XLSX nebo CSV |

Doporučená struktura (složka se v aplikaci vybírá celá, podsložky se prohledají):

```
Logistics/
├── kmenova-data.xlsx     kmenová data dílů
├── Call-offs/            týdenní exporty odvolávek (název souboru s týdnem, např. CW42)
├── Zásoby/               později: Coverage, Komponenty, Zásoby
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
| Cumulative Qty, Cum Shipped | kumulativy, doplňková informace (nedodáno po termínu) | ne |
| Sales Order, Line, Ship-To | rozlišení plánů pro kumulativy | ne |

- Řádky se stejným dílem a dnem (různá odběrná místa, zakázky, reference) se sečtou.
- **Po termínu** = kumulativ požadovaný před prvním dnem exportu minus odesláno, za každý plán zvlášť,
  sečteno za díl (záporné hodnoty se nepočítají).
- CSV: UTF-8 (s BOM i bez) nebo Windows-1250, oddělovač `,` / `;` / tabulátor (rozpozná se),
  čísla `1 905,0` / `1905.0`.
- Excel (XLSX) se čte zhruba 30× pomaleji než CSV, proto je CSV doporučené.

## Kmenová data dílů

Tabulku udržuje uživatel. Jeden řádek = jeden díl.

| Sloupec | Alternativní názvy | Povinný |
|---|---|---|
| Item Number | Díl, Číslo dílu | ano |
| Item Description | Popis | ne |
| Zákazník | Customer | ne |
| Projekt | Project | ne |
| Strana | Side, Řízení (hodnoty `LHD`, `RHD`) | ne |

- Šablonu se všemi díly z aktuálního exportu stáhnete v modulu Data.
- Díly bez kmenových dat lze v Call-offs vyfiltrovat volbou „Bez kmenových dat“.

## Testovací data

`sample-data/` obsahuje smyšlené exporty a kmenová data ve stejném formátu
(`node scripts/generate-sample-data.mjs`). Skutečné exporty do repozitáře nepatří.
