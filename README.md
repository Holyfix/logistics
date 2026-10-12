# Logistics – logistický přehled pro automotive

Webová aplikace pro logistiku dodavatele dílů do automotive (1 závod, 1 sklad).
Načítá CSV exporty z ERP uložené ve firemní sdílené složce a počítá z nich
přehledy: porovnání odvolávek, material coverage, kontrolu kumulativů.

**Data neopouštějí počítač uživatele.** Aplikace běží celá v prohlížeči a na GitHub
Pages leží jen její kód. Zdůvodnění je v [docs/adr/0001-aplikace-v-prohlizeci.md](docs/adr/0001-aplikace-v-prohlizeci.md).

> ⚠️ Repozitář je veřejný. **Nikdy do něj nepřidávejte skutečné exporty ani jiná firemní data.**
> Testovací data patří jen do `sample-data/` a musí být smyšlená. CI kontrola `npm run check:data` selže,
> pokud se datový soubor objeví jinde.

## Vývoj

Potřebujete Node.js 22.

```bash
npm install        # instalace závislostí
npm run dev        # vývojový server na http://localhost:5173
npm test           # testy (Vitest)
npm run lint       # kontrola kódu (ESLint)
npm run typecheck  # kontrola typů (TypeScript)
npm run build      # produkční sestavení do dist/
npm run check:data # kontrola, že v repozitáři nejsou datové soubory
```

Aplikaci je potřeba zkoušet v Microsoft Edge nebo Google Chrome. Jen ty umí číst složky z disku.

## Nasazení

Každý push do větve `main` spustí GitHub Actions: testy, sestavení a nasazení na
GitHub Pages (`.github/workflows/deploy.yml`). Jednorázové nastavení repozitáře
popisuje [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Dokumentace

| Dokument | Obsah |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | Plán vývoje po fázích, otevřené otázky |
| [docs/MODULES.md](docs/MODULES.md) | Katalog modulů a jejich funkcí |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technologie, struktura projektu, moduly |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Datový model a výpočty |
| [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md) | Zdroje dat, formát CSV, průběh načítání |
| [docs/HOSTING.md](docs/HOSTING.md) | Varianty provozu a naměřená rychlost |
| [docs/BACKUP_AND_SECURITY.md](docs/BACKUP_AND_SECURITY.md) | Zálohování, bezpečnost, TISAX |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Nastavení GitHub Pages |
| [docs/adr/](docs/adr/) | Zaznamenaná rozhodnutí |
