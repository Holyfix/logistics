# Datový model

Předběžný návrh. Upřesní se podle skutečných exportů z ERP. Entity se ukládají
v prohlížeči (IndexedDB) a v kódu jsou popsané typy v TypeScriptu (`src/core`).

## Kmenová data

| Entita | Klíčové položky |
|---|---|
| `Part` (díl) | `itemNumber` (ERP), `description`, `unit`, `productLine`, `safetyStockQty`, `type` (výrobek / komponenta) |
| `Customer` | `code`, `name` (v ukázkách „Zákazník A/B/C“) |
| `ShipTo` (odběrné místo) | `customerCode`, `plantCode`, `unloadingPoint` |
| `CustomerPart` | `customerCode`, `shipTo`, `customerPartNumber`, `itemNumber` |
| `BomLine` (kusovník) | `parentItem`, `componentItem`, `qtyPer` |

## Načtené soubory

| Entita | Klíčové položky |
|---|---|
| `SourceFile` | `name`, `kind` (odvolávky / zásoby / expedice / kusovník), `lastModified`, `size`, `sha256`, `asOf` (datum exportu), `status` (ok / s chybami / odmítnut), `rows`, `errors[]` |

Soubor se znovu zpracuje jen při změně `lastModified`, `size` nebo `sha256`.

## Odvolávky

| Entita | Klíčové položky |
|---|---|
| `CallOff` (verze odvolávky) | `sourceFile`, `customerPart`, `releaseNumber`, `releaseDate`, `cumReceivedByCustomer`, `lastDeliveryNote`, `lastDeliveryDate` |
| `CallOffLine` | `dueDate`, `qty`, `commitment` (firm / planning / forecast) |
| `ShipmentCum` | `customerPart`, `cumShipped`, `lastDeliveryNote`, `asOf` |

### Porovnání odvolávek
Pro díl a odběrné místo se porovná nejnovější verze s předchozí (nebo libovolné dvě):
- rozdíl množství po dnech a týdnech (absolutně i v %),
- nové a zrušené termíny,
- zvýraznění změn v závazném horizontu (firm),
- varování nad nastavitelným prahem (např. ±20 %),
- **kontrola kumulativů:** zákazníkem přijato vs. námi odesláno. Rozdíl ukazuje nespárovanou dodávku.

## Zásoby a coverage

| Entita | Klíčové položky |
|---|---|
| `StockSnapshot` | `asOf`, řádky: `itemNumber`, `location`, `qty`, `status` (volné / blokované) |
| `OpenPurchaseOrder` *(pokud bude v exportu)* | `itemNumber`, `expectedDate`, `qty` |

### Výpočet coverage
Pro každý díl a den `d` od dneška:

```
výhled(d) = výhled(d−1) + plánovaná_výroba(d) − poptávka(d)
výhled(včera) = volná zásoba z posledního snímku
```

- `poptávka(d)` = součet nejnovějších odvolávek všech zákazníků
- `plánovaná_výroba(d)` = 0, dokud nebude napojený plán výroby (fáze 6)
- **pokrytí ve dnech** = počet pracovních dní, než výhled klesne pod nulu
- **semafor:** červená < 2 dny, oranžová < 5 dní, zelená ≥ 5 dní (prahy nastavitelné)

U komponent se poptávka rozpadne přes kusovník a místo výroby se přičítají otevřené nákupní objednávky.

## Výroba (fáze 6)

| Entita | Klíčové položky |
|---|---|
| `ProductionPlanLine` | `date`, `shift`, `line`, `itemNumber`, `plannedQty` |
| `ProductionActual` | `date`, `shift`, `line`, `itemNumber`, `goodQty`, `scrapQty` |

## Nastavení

Prahy semaforu, horizont výhledu a jazyk se ukládají v prohlížeči uživatele.
Společné nastavení pro všechny (např. pojistné zásoby) bude jako soubor `nastaveni.json` ve sdílené složce.
