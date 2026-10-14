# Založení projektu Firebase

Postup pro přechod na Firebase ([HOSTING.md](HOSTING.md), varianta 4): přihlášení, živá data a plány pro všechny
uživatele, i na telefonu. Projekt zakládá a vlastní firma; aplikaci pak nasazuje GitHub Actions.
Názvy tlačítek ve Firebase konzoli se mohou mírně lišit.

## 0. Než začnete
- **Schválení ISB** před nahráním skutečných dat. Projekt jde založit a vyvíjet s ukázkovými daty už předtím.
- **Účet Google:** firemní (Google Workspace) nebo samostatný pracovní účet, ne soukromý. Kdo projekt založí,
  je jeho vlastník.
- **Tarif Spark (zdarma), bez platební karty.** Data se ukládají do Firestore, Cloud Storage se nepoužívá.

## 1. Založení projektu
1. https://console.firebase.google.com → **Create a project** (Vytvořit projekt).
2. Neutrální název, např. `logistics` (bez názvu firmy nebo zákazníka).
3. **Google Analytics vypnout.**
4. **Create project.** Tarif zůstane Spark.

## 2. Webová aplikace
1. Na úvodní stránce projektu ikona **`</>`** (Web).
2. Přezdívka např. `Logistics web`; políčko **Firebase Hosting** lze zaškrtnout.
3. **Register app** → zobrazí se blok `firebaseConfig` (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
4. Blok `firebaseConfig` patří do kódu aplikace. **Není to heslo**, je to veřejný identifikátor projektu;
   data chrání přihlášení a bezpečnostní pravidla.
5. Další kroky průvodce (instalace SDK, CLI) přeskočit.

## 3. Databáze Firestore
1. **Build → Firestore Database → Create database.**
2. **Lokalita `europe-west3` (Frankfurt)**, případně `eur3` (Europe). **Později nejde změnit.**
3. **Start in production mode** (databáze zamčená, pravidla jsou v repozitáři).
4. **Create.**

## 4. Přihlášení (Authentication)
**Build → Authentication → Get started → Sign-in method**, jedna z variant:

### Varianta A: firemní účet Microsoft (doporučeno, potřebuje IT)
1. Poskytovatel **Microsoft** → **Enable**.
2. Firebase zobrazí **redirect URI** `https://<projekt>.firebaseapp.com/__/auth/handler`, ten dostane IT.
3. IT v Microsoft Entra ID (Azure AD) založí **App registration**: jen účty organizace (single tenant),
   redirect URI typu Web z bodu 2, vytvoří **Client secret**.
4. **Application (client) ID** a **Client secret** od IT vložit do Firebase → **Save**.
5. Do konfigurace aplikace patří jen **Directory (tenant) ID** (přihlásit se půjde jen firemním účtem).
   Client secret zůstává jen ve Firebase.

### Varianta B: e-mail a heslo (bez IT)
1. **Email/Password** → **Enable**.
2. Uživatelé se přidávají v **Users → Add user**, až bude aplikace hotová.

Seznam povolených uživatelů a jejich role (kdo plánuje kterou linku) bude v databázi, **ne v kódu**:
repozitář je veřejný, e-maily do něj nepatří.

## 5. Hosting
**Build → Hosting → Get started**, jen proklikat. Nasazuje GitHub Actions, aplikace poběží na
`https://<projekt>.web.app`.

## 6. Nasazování z GitHubu
1. ⚙️ **Project settings → Service accounts → Manage service account permissions** (otevře Google Cloud Console).
2. **Create service account**, název `github-deploy`.
3. Role **Firebase Hosting Admin** a **Firebase Rules Admin** (kdyby nasazení hlásilo chybějící oprávnění, doplní se).
4. U účtu **Keys → Add key → Create new key → JSON**, stáhne se soubor.
5. GitHub → repozitář → **Settings → Secrets and variables → Actions → New repository secret**:
   název `FIREBASE_SERVICE_ACCOUNT`, hodnota = celý obsah JSON souboru.
6. Stažený soubor smazat a **nikomu neposílat**.

Když firemní pravidla Googlu nedovolí vytvořit klíč (`iam.disableServiceAccountKeyCreation`), nasazení se nastaví
bez klíče (Workload Identity Federation).

## Co předat vývoji
1. Blok `firebaseConfig` (krok 2).
2. Lokalitu databáze (krok 3).
3. Variantu přihlášení; u varianty A Directory (tenant) ID.
4. Potvrzení, že je na GitHubu secret `FIREBASE_SERVICE_ACCOUNT`.

**Nikdy nepředávat:** Client secret, JSON klíč service accountu, hesla ani seznam e-mailů uživatelů.

## Co bude následovat
1. Přihlášení, hosting na Firebase a uzamčená pravidla databáze. Verze na GitHub Pages zatím poběží dál.
2. Plány a kapacity ve Firestore, živě pro všechny (Excel zůstane ke stažení).
3. Nahrávání dat z ERP: kdo exporty stáhne, nahraje je v aplikaci; ostatním se data sama obnoví.
4. Bezpečnostní pravidla po rolích, testy v emulátoru.
5. Telefon jako aplikace (ikona na ploše, poslední data i bez signálu).
