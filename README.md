# Blackjack B3

Blackjack **multijoueur** dans le navigateur : une table de 5 places, un croupier, des jetons. Les joueurs sont enregistrés dans un **Google Sheet**, et un petit script Google Apps Script attaché à ce Sheet arbitre les parties. Le projet est pensé **sécurité d'abord**.

**Jouer en ligne : https://payzzttv.github.io/BlackjackB3/** (captures d'écran ajoutées après la recette)

- **F1 : inscription par pseudo** (sans mot de passe, session gardée dans un cookie 30 jours)
- **F2 : table partagée** (chacun son tour contre le croupier, mises de 10 à 500 jetons)
- **F3 : classement** (top 10)

Le pourquoi, le périmètre et le modèle de menaces sont détaillés dans [cadrage.md](cadrage.md). Le travail restant et qui fait quoi : [repartition.md](repartition.md).

## Structure

```
frontend/        page statique (HTML/CSS/JS sans dépendance), publiée sur GitHub Pages
  index.html     structure + Content-Security-Policy
  style.css
  app.js         affichage, cookie de session, appels API
  config.js      URL de l'API (factice dans le dépôt, injectée depuis le secret BJ_API_URL)
scripts/
  injecter-config.sh  injection et validation du secret au déploiement
backend/         Google Apps Script (à coller dans l'éditeur du Sheet)
  Code.gs        API HTTP, sessions, quotas, verrous, accès au Sheet
  Table.gs       logique de la table multijoueur (pure)
  Blackjack.gs   règles du blackjack et aléa sécurisé (pures)
  appsscript.json manifeste (scope unique : spreadsheets.currentonly)
tests/           tests Node sans dépendance (le vrai code .gs exécuté avec de faux services Google)
```

## Installation

### 1. Le Google Sheet et l'API (5 minutes)

1. Créez un Google Sheet vide (ex. « Blackjack B3 »). **Ne le partagez avec personne.**
2. Menu **Extensions → Apps Script**.
3. Dans l'éditeur :
   - remplacez le contenu de `Code.gs` par celui de [`backend/Code.gs`](backend/Code.gs) ;
   - ajoutez deux fichiers de script `Table` et `Blackjack` avec le contenu de [`backend/Table.gs`](backend/Table.gs) et [`backend/Blackjack.gs`](backend/Blackjack.gs) ;
   - **Paramètres du projet** (roue dentée) → cochez « Afficher le fichier manifeste appsscript.json », puis remplacez son contenu par [`backend/appsscript.json`](backend/appsscript.json).
4. Sélectionnez la fonction `initialiser` puis **Exécuter**. Acceptez l'autorisation demandée : elle porte uniquement sur *ce* classeur. Les onglets `Joueurs` et `Journal` sont créés.
5. **Déployer → Nouveau déploiement → Application Web** :
   - *Exécuter en tant que* : **Moi** ;
   - *Qui a accès* : **Tout le monde** (indispensable pour que le navigateur des joueurs puisse appeler l'API ; le Sheet, lui, reste privé).
6. Copiez l'URL obtenue (`https://script.google.com/macros/s/…/exec`).

> Pour publier une modification du script : **Déployer → Gérer les déploiements → Modifier → Nouvelle version**. L'URL ne change pas.

Vous pouvez aussi utiliser [`clasp`](https://github.com/google/clasp) (`clasp push` depuis `backend/`). Le fichier `.clasp.json` est ignoré par git.

### 2. Le front

1. **Settings → Secrets and variables → Actions → New repository secret** :
   - *Name* : `BJ_API_URL`
   - *Secret* : l'URL de l'étape précédente (`https://script.google.com/macros/s/…/exec`)
2. **Settings → Pages → Source : GitHub Actions**.
3. Le workflow [`pages.yml`](.github/workflows/pages.yml) publie `frontend/` à chaque push sur `main` : il injecte le secret dans `config.js` via [`scripts/injecter-config.sh`](scripts/injecter-config.sh), qui valide strictement son format. Après avoir créé ou modifié le secret, relancez le workflow (**Actions → Déploiement GitHub Pages → Run workflow**).

**Ne committez jamais l'URL réelle dans `config.js`** : un test de la CI le vérifie.

En local : remplacez temporairement l'URL dans `config.js` (sans committer), puis servez `frontend/` en HTTP sur `localhost` (ex. `npx serve frontend`).

### 3. Tests

Node 20 ou plus, aucune installation :

```bash
node --test "tests/*.test.js"
```

Les tests couvrent les règles, le déroulement de la table, la sécurité de l'API (jetons forgés ou expirés, injection de formule, mises truquées, actions hors tour, carte cachée jamais envoyée, quotas, erreurs sans fuite) et, dans `non-regression.test.js`, chaque anomalie déjà corrigée. La CI ([`tests.yml`](.github/workflows/tests.yml)) les lance à chaque push.

## Jouer

1. Choisissez un pseudo : vous recevez 1 000 jetons.
2. **S'asseoir**, puis **Miser**. La distribution part quand tous les joueurs assis ont misé, ou 8 s après la première mise.
3. À votre tour (15 s) : **Tirer** ou **Rester**. Le croupier tire jusqu'à 17.
4. Blackjack payé 3:2, victoire 1:1, égalité remboursée.

Sans mot de passe, **votre cookie est votre compte** : en navigation privée ou après effacement des cookies, il est perdu. « Supprimer mon compte » libère le pseudo.

## Administration

Depuis l'éditeur Apps Script :
- `initialiser()` : crée les onglets (sans effet s'ils existent déjà) ;
- `reinitialiserTable()` : vide la table en cas de blocage et rembourse les mises en cours.
- `viderCacheJoueurs()` : à lancer après toute modification **à la main** de l'onglet Joueurs (solde, expiration…). Le sondage lit une copie en cache des fiches joueur (jusqu'à 30 min) pour ne pas relire le Sheet toutes les 2,5 s.

Le **Journal** du Sheet trace inscriptions, mises, gains, remboursements et suppressions.

## Sécurité en bref

- Le navigateur n'a aucune autorité : cartes, tours et soldes sont décidés par le serveur.
- Mélange cryptographique (UUID v4 → SHA-256 → Fisher-Yates sans biais).
- Jeton de session de 244 bits, seule son empreinte SHA-256 est stockée.
- Cookie `__Host-` `Secure` `SameSite=Strict`.
- CSP stricte + Trusted Types, aucun `innerHTML`, aucune dépendance tierce.
- Verrou global sur les écritures, quotas par session et à l'inscription.
- Scope Google minimal (`spreadsheets.currentonly`), Sheet non partagé.

Limites assumées et détails : voir [cadrage.md §4](cadrage.md#4-sécurité--le-cœur-du-projet).
