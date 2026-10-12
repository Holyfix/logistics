# Zálohování a bezpečnost

## Kde jsou data

| Co | Kde | Zálohuje |
|---|---|---|
| Exporty z ERP (zdroj pravdy) | Firemní sdílená složka (SharePoint/OneDrive) | Firemní Microsoft 365 (historie verzí, koš, zálohy IT) |
| Zpracovaná data (cache) | Prohlížeč uživatele (IndexedDB) | Nezálohuje se, kdykoli jde znovu vytvořit ze složky |
| Kód aplikace | GitHub (veřejný repozitář) | Git, každý klon je úplná kopie |

Ztráta cache v prohlížeči nevadí. Data se znovu načtou ze složky během několika sekund.

## Pravidla pro sdílenou složku

- Přístup jen pro uživatele aplikace, spravovaný přes oprávnění SharePointu.
- Staré exporty nemazat (historie odvolávek).
- Zapnutá historie verzí (ve výchozím stavu na SharePointu je).

## Bezpečnost aplikace

- **Žádný server, žádné účty.** Kdo nemá přístup ke složce, nevidí žádná data.
- **Nic se neodesílá.** Content-Security-Policy povoluje jen načítání vlastních souborů aplikace (`connect-src 'self'`). Prohlížeč zablokuje jakýkoli pokus o odeslání dat jinam.
- **Žádné externí zdroje.** Písma i knihovny jsou přibalené, aplikace nevolá cizí servery.
- **Žádná data v repozitáři.** Repozitář je veřejný. CI kontrola (`npm run check:data`) odmítne datové soubory (CSV, XLSX, …) mimo `sample-data/` a `.gitignore` je nepřidá omylem.
- **Anonymní dokumentace.** Jména zákazníků, systémů a firmy se v repozitáři neuvádějí.
- Závislosti se aktualizují přes Dependabot. Před nasazením vždy proběhnou testy.

## TISAX

Firma je certifikovaná podle TISAX a odvolávky jsou důvěrné. Varianta v prohlížeči drží
data ve firemním Microsoft 365, přesto je potřeba před použitím na skutečných datech:

1. ukázat aplikaci bezpečnostnímu manažerovi (ISB),
2. doložit Content-Security-Policy a to, že aplikace nic neodesílá,
3. výsledek zapsat jako ADR.

Do té doby se vyvíjí a testuje jen na smyšlených datech.
