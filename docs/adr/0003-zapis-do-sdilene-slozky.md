# ADR 0003: Zápis záznamů do sdílené složky

- **Stav:** navrženo (k potvrzení)
- **Datum:** 2026-10-12

## Kontext

Moduly Obaly (ranní inventura obalů) a později Akční plán potřebují ukládat data,
která zadávají uživatelé. Aplikace nemá server ([ADR 0001](0001-aplikace-v-prohlizeci.md)).
Zapisovat bude několik lidí, řádově desítky záznamů denně.

## Varianty

1. **Záznamy jako soubory ve sdílené složce:** aplikace zapisuje přes File System Access API.
2. **Excel na SharePointu:** lidé zapisují do Excelu, aplikace jen čte.
3. **Server s databází** (varianta 2/3 v HOSTING.md).
4. **SharePoint seznamy přes Microsoft Graph:** vyžaduje registraci aplikace firemním IT.

## Návrh

Varianta 1:
- Každý záznam je **samostatný malý soubor JSON**, např.
  `zaznamy/obaly/2026-10-12_KLT-4314_jnovak.json`. Dva lidé nikdy nezapisují do stejného
  souboru, takže synchronizace OneDrive nevytváří konflikty.
- Záznamy se nepřepisují. Úprava je nový záznam a platí ten poslední, takže zůstává historie změn.
- Autor je jméno zadané v Nastavení. Hesla se neřeší, kdo smí zapisovat, určují oprávnění ke složce.
- Ukládání je v kódu oddělené od formulářů, aby šlo později přejít na server bez změny modulů.

## Důsledky

- 👍 Žádný server ani IT, data zůstávají ve firemním Microsoft 365 včetně historie verzí.
- 👎 Kolegové uvidí změnu až po synchronizaci OneDrive (obvykle do minuty).
- 👎 Autor záznamu není ověřený (jméno, ne přihlášení).
- 👎 Vhodné pro desítky záznamů denně, ne pro tisíce.
