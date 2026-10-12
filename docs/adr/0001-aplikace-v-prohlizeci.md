# ADR 0001: Aplikace běží v prohlížeči, data zůstávají ve firemní sdílené složce

- **Stav:** přijato
- **Datum:** 2026-10-12

## Kontext

- Aplikace má běžet mimo firemní IT, ale firma je certifikovaná podle TISAX a odvolávky zákazníků jsou důvěrné.
- První fáze je jen přehled: čtení exportů z ERP a jejich vyhodnocení, bez společné editace dat.
- Vývojář je jeden a nechce spravovat server.
- ERP umí exportovat CSV (odvolávky ~60 000 řádků na export).

Posuzované varianty jsou v [HOSTING.md](../HOSTING.md): (1) aplikace v prohlížeči, (2) server mimo firmu, (3) server ve firmě.

## Rozhodnutí

Varianta 1:
- Statická aplikace hostovaná na **GitHub Pages** (bezplatný účet, veřejný repozitář).
- Exporty z ERP se ukládají do **firemní sdílené složky** (SharePoint/OneDrive). Aplikace je čte přes File System Access API (Edge, Chrome).
- Zpracovaná data se ukládají v prohlížeči (IndexedDB). Zdrojem pravdy jsou vždy soubory ve složce.
- Aplikace nesmí nic odesílat. Vynucuje to hlavička Content-Security-Policy s `connect-src 'self'`.

## Důsledky

- 👍 Nulové náklady, žádný server, zálohy a oprávnění řeší firemní Microsoft 365.
- 👍 Data neopouštějí firemní prostředí, takže schválení z pohledu TISAX je jednodušší (stále je potřeba konzultovat s ISB).
- 👎 Jen Edge a Chrome na počítači, mobilní telefony nejsou podporované.
- 👎 Bez automatických upozornění a bez společné editace. Pro plánování a Gantt (fáze 7) bude potřeba server.
- 👎 Kód je veřejný, takže v repozitáři nesmí být žádná firemní data ani jména zákazníků a systémů. Hlídá to CI.
- Výpočetní jádro se píše bez závislosti na prohlížeči, aby šlo později použít i na serveru (Node.js).
