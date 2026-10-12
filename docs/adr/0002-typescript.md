# ADR 0002: TypeScript jako jediný jazyk aplikace

- **Stav:** přijato
- **Datum:** 2026-10-12

## Kontext

Aplikace běží v prohlížeči ([ADR 0001](0001-aplikace-v-prohlizeci.md)). Prohlížeč nativně
spouští jen JavaScript; ostatní jazyky se musí převést do WebAssembly. Vývojář zná Python
a TypeScript.

| Možnost | Hodnocení |
|---|---|
| TypeScript | Nativní běh, rychlý start, největší výběr knihoven (tabulky, grafy, Gantt), kontrola typů |
| JavaScript | Totéž bez kontroly typů; chyby v datech se projeví až za běhu |
| Python (Pyodide) | Při prvním otevření 10–30 MB ke stažení, pomalejší start, rozhraní stejně v JavaScriptu, takže dva jazyky |
| Rust/Go/C# (WebAssembly) | Zbytečná složitost; výpočty v TypeScriptu trvají pod 0,5 s (viz HOSTING.md) |

## Rozhodnutí

- Celá aplikace v **TypeScriptu** v přísném režimu (`strict`, `noUncheckedIndexedAccess`).
- Uživatelské rozhraní: **React** + **Vite**. Testy: **Vitest**. Kontrola kódu: **ESLint**.
- Výpočetní jádro (`src/core/`) nesmí záviset na prohlížeči ani Reactu, aby šlo spustit i v Node.js.
- Python zůstává pro pomocné skripty mimo aplikaci (kontrola exportů, příprava testovacích dat).
