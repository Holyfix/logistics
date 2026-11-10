# Testovací data

Sem patří **jen smyšlená data** pro testy a vývoj. Žádné skutečné exporty z ERP,
ani anonymizované. Zákazníky označujte „Zákazník A/B/C“, díly vymyšlenými čísly.

`Lide/Dochazka/pruchody_vzor_11-2026.xlsx` – smyšlený export docházky (tři vymyšlení lidé, listopad 2026)
zašifrovaný heslem `vzor2026` pro modul Docházka a testy rozšifrování.

`Sekvence/` – smyšlená Order Status Matrix a klíč MC/MF (`MC_MF_Item_Mapping_P500.xlsx`) pro kartu Sekvence
v Komponentách; vytvoří je `node scripts/generate-material-sample.mjs`. Ukázkový sklad díly MF nemá, proto v ukázce
všechny dveře chybí.
