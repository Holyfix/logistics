# Načítání dat

## Zdroje

| Data | Zdroj | Formát | Četnost |
|---|---|---|---|
| Odvolávky | ERP (přijaté přes EDI) | CSV, ~60 000 řádků | Denně / při nové odvolávce |
| Expedice a kumulativy | ERP | CSV | Denně |
| Zásoby | ERP | CSV | Denně (snímek) |
| Kusovník | ERP | CSV | Při změně |
| Otevřené nákupní objednávky | ERP | CSV (pokud dostupné) | Denně |
| Plán výroby | Excel / ERP | později | — |
| Skutečná výroba | MES | později | — |

Zákazníci posílají odvolávky ve formátech VDA 4905 a EDIFACT DELFOR/DELJIT. ERP je
převádí do jednotné podoby, proto aplikace čte jen export z ERP, ne EDI zprávy přímo.

## Sdílená složka

```
log1032-data/
├── odvolavky/   2026-10-12_odvolavky.csv, 2026-10-13_odvolavky.csv, …
├── zasoby/      2026-10-12_zasoby.csv, …
├── expedice/    …
├── kusovnik/    kusovnik.csv
└── nastaveni.json   (společné nastavení, fáze 2+)
```

- Datum v názvu souboru určuje, ke kterému dni export patří.
- **Staré exporty se nemažou.** Z nich vzniká historie a porovnání odvolávek.
- Přesné názvy složek a sloupců se upřesní podle ukázek exportů.

## Průběh načítání

```
1. Vyhledání → aplikace projde složku a najde nové nebo změněné soubory
2. Rozpoznání → podle složky a hlavičky určí typ exportu
3. Čtení     → CSV se zpracuje na pozadí (Web Worker), aplikace mezitím reaguje
4. Kontrola  → povinné sloupce, datové typy, neznámá čísla dílů, duplicity, záporná množství
5. Uložení   → zpracovaná data do IndexedDB, chyby do přehledu „Stav dat“
6. Výpočty   → porovnání, coverage a přehledy se přepočítají
```

- Soubor s chybami se načte bez chybných řádků a v přehledu „Stav dat“ se ukáže, co je špatně (řádek, sloupec, důvod).
- Soubor bez povinných sloupců se odmítne celý.

## Pravidla pro CSV

- Kódování UTF-8 nebo Windows-1250 (rozpozná se automaticky)
- Oddělovač `;` nebo `,` (rozpozná se automaticky), desetinná čárka i tečka
- Datum `YYYY-MM-DD` nebo `DD.MM.YYYY`
- První řádek obsahuje názvy sloupců, na pořadí nezáleží
- Mapování názvů sloupců ERP na vnitřní názvy je v konfiguraci, takže změna exportu znamená jen úpravu konfigurace
