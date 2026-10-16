# Mapa dat

Odkud aplikace bere jednotlivé údaje a jak jsou soubory navázané. Stejné tabulky jsou v aplikaci v modulu **Data**
(panel Mapa dat), kde je i **Kontrola mapování**.

## Princip

- **Item_Mapping je jediný zdroj vlastností dílu** (projekt, zákazník, strana, varianta, kategorie, balení, linka …).
  Co se má změnit, mění se tam.
- Spojovacím klíčem je **naše číslo dílu (Item Number)**. Soubory Coverage se na něj napojí přes **číslo zákazníka
  (Customer Number)** v mapování.
- Údaj vyplněný v mapování má **vždy přednost**. Záloha (složka Coverage, kusovník, text popisu) se použije jen tam,
  kde v mapování chybí – a Kontrola mapování ukáže, kde k tomu došlo.
- Složka Coverage (`Coverage/Destinace/Projekt/`) určuje **jen destinaci**; projekt ze složky je jen záloha.

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

| Údaj | Zdroj (sloupec mapování) | Když v mapování chybí | Kde se používá |
|---|---|---|---|
| Projekt | Project | Coverage a Plánování: název složky; Komponenty: sloupec v kusovníku | všechny moduly |
| Destinace | — (jen složka Coverage) | — | Coverage, Plánování |
| Zákazník | Customer | prázdné | filtry Odvolávek |
| Strana | Side, jinak LHD/RHD na začátku Variant | Plánování: LHD/RHD z popisu | Odvolávky, Plánování |
| Varianta | Variant | prázdné | souhrn v Coverage |
| Kategorie | Category | prázdné | filtry, přehled Odvolávek |
| Popis | Description | text ze souboru Coverage nebo odvolávek | všechny moduly |
| Číslo zákazníka | Customer Number | zápis ze souboru Coverage | Coverage, Plánování |
| Balení | Order Multiple | balení linky v Kapacitách (výchozí 12) | Plánování |
| Montážní díly | Line = ASSEMBLY | bez sloupce Line všechny díly z Coverage | Plánování |
| Sledované komponenty | Component Coverage | kusovník: zdroj „P“ | Komponenty |

Sloupce Type, Safety Stock a Safety Time se zatím nepoužívají.

## Kontrola mapování (modul Data)

Kontroluje díly, se kterými aplikace pracuje (soubory Coverage a aktuální export odvolávek):

1. **Díly bez mapování** – číslo zákazníka z Coverage nebo díl z odvolávek, který v mapování není.
2. **Díly s nevyplněnými údaji** – prázdný projekt, zákazník, strana, kategorie; balení jen u dílů pro plán montáže.
   Když v souboru chybí celý sloupec, hlásí se jednou nahoře, ne u každého dílu.
3. **Projekt v mapování jiný než složka Coverage** – aplikace použije projekt z mapování. Když soubor záměrně obsahuje
   díly více projektů, je to v pořádku.

Celou kontrolu lze stáhnout do Excelu (tři listy). Počet dílů k doplnění ukazuje i karta Data na Dashboardu.
