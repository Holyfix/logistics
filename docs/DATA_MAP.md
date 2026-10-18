# Mapa dat

Odkud aplikace bere jednotlivé údaje a jak jsou soubory navázané. Stejné tabulky jsou v aplikaci v modulu **Data**
(panel Mapa dat), kde je i **Kontrola mapování**.

## Princip

- **Item_Mapping je jediný zdroj vlastností dílu** (druh dílu, projekt, kategorie, strana, varianta, popis, linka,
  balení). Aplikace je **nedoplňuje odjinud** – ani ze složky Coverage, ani z kusovníku, ani
  z popisu. Co se má změnit, mění se jen v mapování.
- Co v mapování chybí, **ukáže Kontrola mapování** (modul Data) a upozornění nahoře v modulech Coverage, Odvolávky,
  Plánování a Komponenty; dlaždice Data na Dashboardu je pak žlutá.
- Spojovacím klíčem je **naše číslo dílu (Item Number)**. Soubory Coverage se na něj napojí přes **číslo zákazníka
  (Customer Number)** v mapování.
- Složka Coverage (`Coverage/Destinace/Projekt/`) určuje **jen destinaci**. Název složky projektu se nepoužívá (jen jako
  nápověda v Kontrole mapování u dílů, které v mapování chybí).
- Díl, který v mapování není, ukáže číslo a popis ze souboru jen proto, aby šel poznat.

## Soubory

| Soubor | Co se z něj bere | Napojení |
|---|---|---|
| Item_Mapping | druh dílu (list FG / SFG / PG), číslo zákazníka, popis, projekt, kategorie, strana, varianta, linka, balení | hlavní číselník dílů |
| Coverage (`Coverage/Destinace/Projekt/`) | zásoba u zákazníka a transit po dnech, destinace ze jména složky | číslo zákazníka → Customer Number |
| Odvolávky | požadavky po týdnech, odesláno, popis | Item Number |
| Sklad | množství na lokacích | Item Number |
| Kusovník (BOM) | komponenty hotových dílů | Item Number |
| OIL, Plán | vlastní data modulů | — |

## Údaje o dílu

| Údaj | Sloupec mapování | Když v mapování chybí | Kde se používá |
|---|---|---|---|
| Druh dílu | Item Type (FG, SFG, PG) | kontrola podle modulů | Kontrola mapování |
| Projekt | Project | prázdné (bez projektu) | všechny moduly |
| Destinace | — (složka Coverage; není vlastnost dílu) | — | Coverage, Plánování |
| Strana | Side (jen kategorie dělené na LHD / RHD), jinak LHD/RHD na začátku Variant | prázdné (díl bez strany) | Odvolávky, Coverage, Plánování |
| Varianta | Variant (jen díly, které je potřeba rozlišit) | prázdné (díl bez varianty) | Odvolávky, Coverage, Plánování |
| Kategorie | Category | prázdné | filtry, přehled Odvolávek |
| Popis | Description | prázdné; díl bez mapování ukáže text ze souboru, jen aby šel poznat | všechny moduly |
| Číslo zákazníka | Customer Number | díl se nespojí s Coverage; díl bez mapování ukáže zápis ze souboru | Coverage, Plánování |
| Balení | Order Multiple | plán se nezaokrouhluje na balení | Plánování |
| Montážní díly | Line = ASSEMBLY | díl není v plánu montáže | Plánování |
| Sledované komponenty | Item Type = PG (list PG) | díl se nesleduje | Komponenty |

Sloupce Customer, Component Coverage, Type, Safety Stock a Safety Time se nepoužívají.

## Kontrola mapování (modul Data)

Ukazuje přesně, **co v Item_Mapping doplnit a kvůli kterým modulům**.

**Co který modul potřebuje** (u dílů, se kterými pracuje):

| Modul | Díly | Sloupce mapování |
|---|---|---|
| Coverage (i dlaždice Zákazník) | díly ze souborů Coverage | Project, Category, Side*, Description |
| Odvolávky | díly z aktuálního exportu | Project, Category, Side*, Description |
| Plánování | díly z Coverage a vyráběné díly z kusovníků (SFG) | Line; u dílů s Line = ASSEMBLY navíc Project, Side*, Description, Order Multiple; u vyráběných dílů z kusovníku Project, Description, Line |
| Komponenty | nakupované díly z kusovníků (PG) | Description; sledují se všechny díly PG |

Díl z kusovníku je nakupovaný podle sloupce Purchase/Manufacture (P); bez údaje je nakupovaný díl, pod kterým už nic
není, ostatní jsou vyráběné. Díl, který v mapování chybí, má v kontrole navržený list: z odvolávek nebo Coverage FG,
vyráběný z kusovníku SFG, nakupovaný PG – na tento list ho dá i šablona mapování.

\* Strana jen v kategoriích projektu, které se dělí na LHD / RHD (aspoň jeden díl kategorie projektu stranu má).
Bere se ze sloupce Side, jinak z LHD/RHD na začátku Variant. Varianta se nekontroluje – použije se, je-li vyplněná.

**Druh dílu (sloupec Item Type)** určuje, co má být u dílu vyplněné:

| Sloupec | FG (hotový výrobek) | SFG (mezivýroba, WIP) | PG (nakupovaný) |
|---|---|---|---|
| Customer Number | ano | – | – |
| Project | ano | ano | – |
| Category | ano | – | – |
| Side (nebo LHD/RHD ve Variant) | jen v kategoriích dělených na LHD / RHD | – | – |
| Variant | volitelně (nekontroluje se) | – | – |
| Description | ano | ano | ano |
| Line | ano | ano | – |
| Order Multiple | u linky ASSEMBLY | – | – |

Díly s druhem se kontrolují celé (i ty, které se v načtených datech nepoužívají). Díl bez druhu se kontroluje podle
modulů, ve kterých je (tabulka výše), a kontrola k němu hlásí chybějící druh.

Jeden řádek mapování = jeden díl; vyplňuje se jen to, co díl potřebuje:

- **Side** – jen v kategoriích projektu, kde se díly dělí na LHD / RHD (např. DP ano, IP ne).
- **Variant** – jen u dílů, které je potřeba rozlišit (např. SR1 / SR2 Heating); zapisuje se bez strany.
- **Order Multiple** – jen u hotových výrobků do montáže (Line = ASSEMBLY).
- **Customer Number** – u všech hotových výrobků (FG); podle něj se Coverage spojí s dílem. U komponent
  a mezivýrob zůstává prázdné.

**Co kontrola ukazuje:**

1. **Sloupce** – sloupec, který v souboru chybí (a které moduly ho potřebují), Line bez jediného ASSEMBLY u dílů
   z Coverage (prázdný plán montáže).
2. **Co chybí po modulech** – tabulka modul × sloupec: počet dílů, u kterých je potřeba údaj doplnit, ✓ v pořádku,
   · modul údaj nepotřebuje. Kliknutím na modul se seznam dílů vyfiltruje.
3. **Díly k doplnění** – pro každý díl: celý nový řádek (díl v mapování není; u dílů z Coverage s nápovědou složky),
   nebo konkrétní sloupce (např. „Balení (Order Multiple)“), a kvůli kterým modulům. Filtr podle modulu.

Celou kontrolu lze stáhnout do Excelu (listy Co doplnit, Po modulech, Sloupce). V modulech Coverage, Odvolávky,
Plánování a Komponenty je nahoře upozornění jen pro daný modul; dlaždice Data na Dashboardu je žlutá, když něco chybí.
