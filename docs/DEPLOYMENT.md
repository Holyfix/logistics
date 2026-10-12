# Nasazení na GitHub Pages

Jednorázové nastavení repozitáře. Pak už stačí pushnout do větve `main`.

## 1. Zkontrolovat, že v repozitáři nejsou citlivé údaje

Repozitář bude veřejný včetně celé historie. Před zveřejněním:

```bash
npm run check:data
```

a projít, že dokumentace neobsahuje jména zákazníků, systémů ani firmy.

## 2. Zveřejnit repozitář

GitHub → repozitář → **Settings** → **General** → úplně dole **Danger Zone** →
**Change repository visibility** → **Make public**.

## 3. Zapnout GitHub Pages

GitHub → repozitář → **Settings** → **Pages** → **Build and deployment** →
**Source: GitHub Actions**.

## 4. Větev `main`

Nasazení se spouští při pushi do `main` (`.github/workflows/deploy.yml`).
Vývoj probíhá ve vedlejších větvích a do `main` se dostává přes pull request.
Pokud je potřeba nasadit ručně: **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

## 5. Výsledek

Aplikace poběží na `https://holyfix.github.io/logistics/`.
Adresu ukazuje **Settings → Pages** i výstup posledního nasazení v záložce **Actions**.
