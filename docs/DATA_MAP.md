# Mapa dat

Odkud aplikace bere jednotlivé údaje a jak jsou soubory navázané. Stejné tabulky jsou v aplikaci v modulu **Data**
(panel Mapa dat), kde je i **Kontrola mapování**.

## Princip

- **Item_Mapping je jediný zdroj vlastností dílu** (projekt, zákazník, strana, varianta, kategorie, popis, linka,
  balení, sledování komponent). Aplikace je **nedoplňuje odjinud** – ani ze složky Coverage, ani z kusovníku, ani
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
| Item_Mapping | číslo zákazníka, popis, projekt, zákazník, strana, varianta, kategorie, linka, balení, sledování komponent | hlavní číselník dílů |
| Coverage (`Coverage/Destinace/Projekt/`) | zásoba u zákazníka a transit po dnech, destinace ze jména složky | číslo zákazníka → Customer Number |
| Odvolávky | požadavky po týdnech, odesláno, popis | Item Number |
| Sklad | množství na lokacích | Item Number |
| Kusovník (BOM) | komponenty hotových dílů | Item Number |
| OIL, Plán | vlastní data modulů | — |

## Údaje o dílu

| Údaj | Sloupec mapování | Když v mapování chybí | Kde se používá |
|---|---|---|---|
| Projekt | Project | prázdné (bez projektu) | všechny moduly |
| Destinace | — (složka Coverage; není vlastnost dílu) | — | Coverage, Plánování |
| Zákazník | Customer | prázdné | filtry Odvolávek |
| Strana | Side, jinak LHD/RHD na začátku Variant | prázdné | Odvolávky, Plánování |
| Varianta | Variant | prázdné | souhrn v Coverage |
| Kategorie | Category | prázdné | filtry, přehled Odvolávek |
| Popis | Description | prázdné; díl bez mapování ukáže text ze souboru, jen aby šel poznat | všechny moduly |
| Číslo zákazníka | Customer Number | díl se nespojí s Coverage; díl bez mapování ukáže zápis ze souboru | Coverage, Plánování |
| Balení | Order Multiple | plán se nezaokrouhluje na balení | Plánování |
| Montážní díly | Line = ASSEMBLY | díl není v plánu montáže | Plánování |
| Sledované komponenty | Component Coverage = Ano | komponenta se nesleduje | Komponenty |

Sloupce Type, Safety Stock a Safety Time se zatím nepoužívají.

## Kontrola mapování (modul Data)

Kontroluje díly, se kterými aplikace pracuje (soubory Coverage, aktuální export odvolávek, hotové díly z kusovníků):

1. **Díly bez mapování** – číslo zákazníka z Coverage nebo díl z odvolávek či kusovníku, který v mapování není.
   U dílů z Coverage je jako nápověda složka (projekt).
2. **Díly s nevyplněnými údaji** – prázdný projekt, zákazník, strana, kategorie nebo popis; linka u dílů z Coverage;
   balení u dílů s Line = ASSEMBLY.
3. **Chybějící sloupce** – když v souboru chybí celý sloupec (Component Coverage jen s načteným kusovníkem), hlásí se
   jednou nahoře, ne u každého dílu.

Celou kontrolu lze stáhnout do Excelu. Počet dílů k doplnění ukazuje i dlaždice Data na Dashboardu.
