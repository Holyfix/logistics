# Varianty provozu

**Rozhodnuto:** varianta 1 ([ADR 0001](adr/0001-aplikace-v-prohlizeci.md)).
Ostatní varianty zůstávají jako možnost pro fázi 7 (plánování se společnou editací).

## Co umí GitHub Pages

GitHub Pages hostuje jen **statické soubory** (HTML, CSS, JavaScript). Neumí spustit
serverový kód, provozovat databázi ani skrýt stránku za přihlášení (to umí jen GitHub
Enterprise Cloud). S bezplatným účtem musí být repozitář veřejný.

## Varianta 1: Aplikace v prohlížeči, data ve firemní sdílené složce ✅
```
GitHub Pages (jen kód) ──► Prohlížeč ──čte──► sdílená složka (CSV exporty z ERP)
                            └─ výpočty běží na počítači uživatele
```
- **Plusy:** zdarma, bez serveru, data neopustí firemní Microsoft 365, zálohy a oprávnění řeší SharePoint.
- **Minusy:** jen Edge a Chrome na počítači, bez automatických upozornění, bez společné editace, veřejný kód.

## Varianta 2: Server mimo firmu
- Backend + databáze na pronajatém serveru nebo v cloudu v EU.
- **Plusy:** sdílená data, účty, upozornění, společné plánování.
- **Minusy:** měsíční poplatky, správa serveru, důvěrná data u třetí strany (nutný souhlas ISB).

## Varianta 3: Server uvnitř firmy
- Jako varianta 2, ale na firemním serveru nebo ve firemním cloudu.
- **Plusy:** nejlepší z hlediska TISAX. **Minusy:** závislost na firemním IT.

## Varianta 4: Firebase (zvažováno)
```
Firebase Hosting (kód) ──► Prohlížeč / telefon ──přihlášení──► Firebase Authentication
                            ├─ nahraje zpracované exporty z ERP ──► Firestore (EU)
                            └─ plány a kapacity živě pro všechny ◄──► Firestore
```
- **Plusy:** přihlášení, živá data a plány pro všechny uživatele, i na telefonu; tarif Spark zdarma;
  výpočty a obrazovky zůstávají, mění se jen vrstva čtení a ukládání dat.
- **Minusy:** zpracovaná data u Googlu (nutný souhlas ISB), exporty z ERP se dál nahrávají ručně,
  bezpečnost stojí na správných pravidlech databáze.
- Postup založení projektu: [FIREBASE_SETUP.md](FIREBASE_SETUP.md).

## Naměřená rychlost varianty 1

Test v Chromiu na smyšlených souborech (3 000 dílů × 50 termínů = 150 000 řádků odvolávek):

| Krok | Řádků | Excel (XLSX) | CSV |
|---|---|---|---|
| Načtení odvolávek | 150 000 | 6–12 s | 0,2 s |
| Načtení kusovníku | 20 000 | 0,5 s | — |
| Výpočty (porovnání, coverage, rozpad kusovníku) | — | 0,4 s | 0,4 s |

ERP exportuje CSV (~60 000 řádků), takže zpracování jednoho exportu trvá přibližně 0,1 s.

### Po zavření prohlížeče
- Zpracovaná data zůstávají v prohlížeči (IndexedDB) i po restartu počítače. Při dalším otevření se zpracují jen nové soubory.
- Cache se ztratí po smazání dat prohlížeče, v anonymním okně, na jiném počítači nebo při mazání profilu při odhlášení. Pak se vše znovu načte ze složky, což trvá několik sekund.
- Podrobně se drží posledních ~30 verzí odvolávek, starší jako souhrny. Úložiště zůstane v řádu desítek MB.
- Přístup ke složce: po novém spuštění se prohlížeč může znovu zeptat (jedno kliknutí). Novější Edge a Chrome umí povolení zapamatovat.
