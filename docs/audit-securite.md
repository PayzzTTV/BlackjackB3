# Audit de sécurité complet : Blackjack B3

Responsable : **rôle C**. Complète le [pentest](pentest.md) (attaques rejouées sur l'API) et l'[audit OWASP](owasp.md) du même jour. Cet audit reprend tout le code ligne par ligne et cherche ce que les deux précédents n'ont pas vu.

## Campagne du 2026-11-10 (soir)

- **Testeur** : rôle C (Alexis), exécution assistée par Claude Code
- **Versions** : `develop` @ `1a2cbef` (revue de code), `main` @ `eb615a4` (site publié)
- **Méthode** :
  - revue complète de `backend/*.gs`, `frontend/app.js`, `index.html`, workflows et scripts ;
  - preuves rejouées sur le back simulé, avec un cache **à durée de vie** et une horloge pilotée (le cache de `tests/faux-apps-script.js` n'expire jamais, ce qui masque le constat 1) ;
  - sondes à faible débit sur l'API en ligne, avec des **jetons inventés** : aucun compte créé, 100 requêtes (20 simultanées puis 80 en série) ;
  - réglages du dépôt lus par l'API GitHub ; en-têtes et fichiers exposés avec `curl` ;
  - 63 tests locaux : tous passent.
- **Pas fait** : aucun compte créé en production, aucun test de charge, aucun accès au Sheet ni à l'éditeur Apps Script (réservés au rôle A).

## Synthèse

| # | Gravité | Constat | Prouvé | Statut |
|---|---|---|---|---|
| 1 | **Haute** | Le limiteur de requêtes n'est pas une fenêtre glissante : un joueur honnête est bloqué 1 minute toutes les 4 à 5 minutes, et les inscriptions se bloquent après 30 comptes même étalés sur des heures. | Local + en ligne | ✅ Corrigé (branche `fix/c-limiteur-fenetre`), **à redéployer** |
| 2 | **Haute** | Le correctif du verrou global (PR #58) n'est pas sur `main`. Le déploiement Apps Script est manuel : rien ne garantit que le code en ligne est le code relu. | `git` | ⏳ Ouvert : release et redéploiement à faire à la main |
| 3 | Moyenne | Le quota par session ne limite pas un attaquant : compteur non atomique, et chaque jeton inventé a son propre quota et coûte une lecture complète du Sheet (2,2 s mesurées en ligne). | Local + en ligne | ✅ Atténué (seuil global), **à redéployer** ; compteur non atomique et limite de la plateforme : restent |
| 4 | Moyenne | L'autre site GitHub Pages du compte partage toujours l'origine du jeu et charge 4 scripts de CDN sans SRI ni CSP. | En ligne | ⏳ Ouvert (owasp n° 2) : hors de ce dépôt |
| 5 | Moyenne | Les comptes expirés ne sont jamais purgés : pseudo bloqué à vie, présence au classement, Sheet qui grossit (donc chaque requête ralentit). | Local | ✅ Corrigé, **à redéployer** + déclencheur quotidien à créer |
| 6 | Faible | Le renouvellement de session écrit dans le Sheet **hors verrou**. | Revue | ✅ Corrigé, **à redéployer** |
| 7 | Faible | Pseudos trompeurs acceptés (`Croupier_`, `Cr0upier`, `adm1n`) et noms d'objets JavaScript (`__proto__`, `constructor`). | Local | ✅ Corrigé, **à redéployer** |
| 8 | Faible | Quitter la table après « Rester » fait perdre la mise, même avec une main gagnante. | Local | ✅ Corrigé, **à redéployer** |
| 9 | Faible | Dépôt : toutes les actions GitHub autorisées, pas de `CODEOWNERS` sur `backend/` et `.github/`. | API GitHub | ◐ `CODEOWNERS` ajouté ; réglages du dépôt à faire à la main |
| 10 | Info | CSP : `connect-src` autorise n'importe quelle Web App Apps Script. Journal sans purge, qui garde les pseudos des comptes supprimés. | Revue | ✅ Corrigé (CSP vérifiée dans le navigateur) |

Les constats 3 à 6 de l'[audit OWASP](owasp.md) (squat de la table, quota d'inscriptions global, classement manipulable, refus non journalisés) restent ouverts et ne sont pas répétés ici.

**Aucune faille permettant de tricher, de voir la carte cachée, de modifier un solde ou d'usurper un joueur n'a été trouvée.** Les problèmes sont tous de disponibilité, de configuration ou d'hygiène.

## Correctifs appliqués (branche `fix/c-limiteur-fenetre`)

74 tests passent, dont 11 nouveaux ; 8 d'entre eux échouent sur l'ancien code.

| Constat | Correctif | Fichiers |
|---|---|---|
| 1 | Limiteur à fenêtre fixe ; quota d'inscription décompté après le contrôle du pseudo. | `backend/Code.gs` |
| 3 | Compteur **global** des jetons inconnus (300/min). Au-delà, un jeton absent du cache est refusé sans lire le Sheet ; les joueurs en cache continuent de jouer. | `backend/Code.gs` |
| 5 | Comptes expirés masqués du classement ; pseudo expiré libéré à la réinscription ; fonction `purgerComptesExpires()` (comptes expirés + Journal de plus de 30 jours). | `backend/Code.gs` |
| 6 | Le renouvellement de session n'écrit plus que sous verrou. | `backend/Code.gs` |
| 7 | Pseudos comparés aux mots réservés après remplacement des chiffres ressemblants et retrait des `_` ; pseudos en `__` refusés ; `Object.create(null)` côté client. | `backend/Code.gs`, `frontend/app.js` |
| 8 | Quitter après « Rester » ou avec un blackjack : la place reste jusqu'au règlement, le gain est versé, puis la place disparaît. La suppression du compte retire toujours la place tout de suite. Aide et message de confirmation mis à jour. | `backend/Table.gs`, `frontend/` |
| 9 | `.github/CODEOWNERS` : relecture demandée au rôle C sur `backend/`, `.github/`, `scripts/`, `SECURITY.md`. | `.github/CODEOWNERS` |
| 10 | `connect-src` limité à l'URL exacte de la Web App, injectée au déploiement. Vérifié dans le navigateur : l'API répond, une autre Web App Apps Script et `example.com` sont bloquées. | `scripts/injecter-config.sh`, `pages.yml` |

**Limites des correctifs** :
- constat 3 : pendant une rafale, un vrai joueur dont la fiche n'est plus en cache (30 min sans action de jeu) est refusé jusqu'à la fenêtre suivante. Le compteur par session reste non atomique. La limite de 30 exécutions simultanées de Google ne se corrige qu'avec un proxy devant l'API ;
- constat 7 : un pseudo honnête qui contient un mot réservé (« Groot » contient « root ») est refusé.

**Reste à faire à la main** :
1. release `develop` → `main`, puis recoller `Code.gs` **et** `Table.gs` dans Apps Script et redéployer ;
2. archiver les anciens déploiements Apps Script ;
3. créer le déclencheur quotidien de `purgerComptesExpires` (éditeur Apps Script → Déclencheurs) ;
4. sortir le site `alexisdelburg.github.io` du compte, ou lui ajouter SRI et CSP (constat 4) ;
5. réglages du dépôt (constat 9) : liste blanche d'actions, approbation après le dernier push, motifs génériques du secret scanning.

## Détail des constats

### 1. Le limiteur bloque les joueurs honnêtes (Haute)

- **Où** : `limiter_()` dans `backend/Code.gs`. Chaque requête acceptée fait `cache.put(clé, n + 1, fenêtre)`, et `put` **repousse l'expiration** à chaque appel. Tant qu'un client envoie au moins une requête par minute, le compteur ne retombe jamais à zéro : c'est un cumul, pas « 90 par minute ».
- **Preuve locale** (script jetable, non commité : vrai code du back, cache à durée de vie, horloge pilotée) :
  - un joueur qui sonde toutes les 3 s (20 requêtes/min, quota de 90) est refusé pour la première fois à **t = 270 s**, puis 14 % de ses sondages sont refusés sur 20 minutes ;
  - une inscription toutes les 10 minutes (6 par heure, quota de 30) : la **31e est refusée après 5 h** ;
  - 30 tentatives sur un pseudo **déjà pris** bloquent toutes les inscriptions, sans créer un seul compte (le quota est décompté avant le contrôle `pseudo_pris`).
- **Preuve en ligne** (jeton inventé, aucun compte) : 99 requêtes étalées sur environ 3 minutes, soit **34 requêtes/min pour un quota de 90**, et la 100e est refusée (`trop_de_requetes`). Le compteur n'est jamais retombé.
- **Impact** : pendant le blocage, le joueur voit « Trop de requêtes », ne peut ni miser ni tirer, et reste automatiquement à la fin de ses 15 s. À la soutenance, la 31e personne qui s'inscrit est refusée tant que les inscriptions s'enchaînent à moins d'une heure d'intervalle.
- **Correctif (fait)** : fenêtre fixe. Mettre le numéro de fenêtre dans la clé (`'rl:' + clé + ':' + Math.floor(Date.now() / (fenêtre × 1000))`) : le compteur repart de zéro à chaque fenêtre, quelle que soit l'expiration du cache. Décompter l'inscription **après** le contrôle `pseudo_pris`. Le faux cache des tests a maintenant une durée de vie et une horloge pilotable ; 3 tests de non-régression, dont 2 échouent sur l'ancien code. Le compteur reste non atomique (constat 3). En ligne, le correctif n'agit qu'après redéploiement de `backend/Code.gs`.

### 2. Correctif du verrou absent de `main`, déploiement non vérifiable (Haute)

- **Constat** : `git merge-base --is-ancestor bdf7c12 origin/main` répond non. Le correctif de l'[audit OWASP n° 1](owasp.md#1-verrou-global-pris-par-des-jetons-inconnus-haute) n'existe que sur `develop`.
- **Problème de fond** : le back est collé à la main dans l'éditeur Apps Script. Rien ne relie la version en ligne à un commit relu, et un ancien déploiement reste actif tant qu'il n'est pas archivé : il sert l'ancien code sur le même Sheet.
- **À faire** :
  1. release `develop` → `main`, puis redéployer `backend/Code.gs` ;
  2. dans Apps Script → Déployer → Gérer les déploiements : **archiver tous les déploiements sauf un** ;
  3. ajouter une constante `VERSION` renvoyée par `etat`, et la comparer dans `scripts/pentest.js` au commit testé.

### 3. Le quota par session ne limite pas un attaquant (Moyenne)

- **Compteur non atomique** : lecture puis écriture sans verrou. Des requêtes simultanées lisent la même valeur. En ligne : après **20 requêtes simultanées** avec le même jeton, le compteur ne valait que **11**. Au total, 99 requêtes ont été acceptées au lieu de 90 ; avec une rafale plus large, l'écart grandit d'autant.
- **Un quota par jeton inventé** : sur le back simulé, 200 sondages avec 200 jetons aléatoires donnent **0 refus et 200 lectures complètes du Sheet** (0,5 à 2 s chacune en ligne). Le compte Google qui déploie est limité à 30 exécutions simultanées : une trentaine de connexions suffit à rendre le jeu indisponible.
- **Impact** : le quota protège contre un client bogué, pas contre une attaque. C'est une limite de la plateforme (pas d'adresse IP), mais elle n'est décrite nulle part comme telle : [SECURITY.md](../SECURITY.md) classe le contournement des quotas dans le périmètre.
- **Pistes** :
  - court terme : compteur **global** des `session_invalide` (par exemple 300/min), au-delà duquel les jetons absents du cache sont refusés sans lire le Sheet. Les joueurs déjà en cache continuent de jouer ;
  - vraie solution : un proxy devant l'API (Cloudflare Worker gratuit). Il apporte la limitation par IP, un cookie `HttpOnly` et une origine dédiée : il règle aussi le constat 4 et la première limite de [cadrage §4.5](../cadrage.md#45-limites-connues-transparence).

### 4. Origine partagée avec un site non maîtrisé (Moyenne, toujours ouvert)

- **Vérifié ce soir** : `https://payzzttv.github.io/alexisdelburg.github.io/` répond 200, charge `qrcode.min.js`, `gsap.min.js`, `ScrollTrigger.min.js` (cdnjs) et `lenis.min.js` (jsDelivr) sans `integrity`, contient 2 scripts inline et aucune CSP.
- **Impact et correctifs** : voir [owasp.md n° 2](owasp.md#2-origine-partagée-avec-un-site-qui-charge-des-scripts-tiers-moyenne). Le plus simple : déplacer ce site sur un autre compte GitHub.

### 5. Comptes expirés jamais purgés (Moyenne)

- **Preuve locale** : avec une session expirée, `etat` répond `session_invalide`, mais la réinscription du même pseudo répond `pseudo_pris` et le compte reste au classement.
- **Impact** :
  - un pseudo est perdu à vie dès que son cookie est perdu ; un attaquant peut réserver 30 pseudos par heure, définitivement ;
  - `joueurs_()` relit **tout** l'onglet à chaque requête hors cache : plus il y a de lignes mortes, plus tout le monde attend sous le verrou.
- **Correctif** : fonction `purgerComptesExpires()` sous verrou (supprime les lignes dont `jeton_expire` est dépassé et qui ne sont pas à la table), lancée par un déclencheur quotidien. Filtrer aussi les expirés dans `actionClassement_`.

### 6. Écriture dans le Sheet hors verrou (Faible)

- **Où** : `joueurDepuisSheet_()` est appelée hors verrou par `authentifier_()` et y fait un `setValue` (renouvellement de `jeton_expire`) sur un numéro de ligne lu avant.
- **Risque** : si un compte situé plus haut est supprimé entre la lecture et l'écriture, les lignes remontent et l'expiration est écrite sur la ligne **d'un autre joueur**. Conséquence limitée (une session prolongée, voire une session expirée réactivée), mais le principe « toute écriture sous verrou », sur lequel repose la cohérence du cache, n'est pas respecté.
- **Correctif** : ne renouveler que si `memo_.sousVerrou` est vrai. Hors verrou, la fonction ne fait que lire.

### 7. Pseudos trompeurs ou piégés (Faible)

- **Preuve locale** : `Croupier_`, `Cr0upier`, `Admin_`, `adm1n`, `Moderateur1`, `__proto__`, `constructor`, `toString` sont acceptés.
- **Impact** :
  - usurpation visuelle au classement et à la table ;
  - `__proto__` et `constructor` servent de clé dans `etat.cartesVues.mains` (`frontend/app.js`) : les cartes de ce joueur ne sont plus animées chez les autres. Pas de pollution de prototype (vérifié), le serveur n'indexe aucun objet par pseudo.
- **Correctif** : refuser les pseudos qui **contiennent** un mot réservé après remplacement des chiffres ressemblants (`0→o`, `1→i`, `3→e`, `4→a`), et ceux qui commencent par `__`. Côté client, `mains: Object.create(null)`.

### 8. Quitter après « Rester » fait perdre la mise (Faible)

- **Preuve locale** : Alice mise 100, reste, puis quitte pendant le tour de Bob : solde 900, sans règlement, même si sa main aurait gagné.
- **Analyse** : `tbQuitter()` retire la place sans distinguer « main en cours » de « main terminée en attente du croupier ». Ce n'est pas exploitable pour tricher, mais le joueur est lésé et l'aide du jeu ne le dit pas. La même chose arrive avec un blackjack servi.
- **Correctif** : si le statut est `reste` ou `blackjack`, garder la place jusqu'au règlement (marquée « part à la fin de la manche »), ou l'écrire dans l'aide.

### 9. Réglages du dépôt (Faible)

Conformes : `main` et `develop` protégées (1 relecture, CI `tests` obligatoire, admins inclus, pas de force-push), jeton de workflow en lecture seule, environnement `github-pages` limité à `main`, secret scanning et push protection actifs, 0 alerte ouverte (CodeQL, secrets, Dependabot), aucune URL d'API ni secret dans l'historique.

À durcir :

| Réglage | Actuel | Conseillé |
|---|---|---|
| Actions autorisées | toutes | liste blanche (`actions/*`, `github/codeql-action/*`) et épinglage par SHA obligatoire |
| `CODEOWNERS` | absent | rôle C relecteur obligatoire sur `backend/`, `.github/`, `scripts/` |
| Approbation après le dernier push | non | oui : l'auteur ne peut pas ajouter un commit après la relecture |
| Secret scanning, motifs génériques | désactivé | activé |

### 10. Durcissements (Info)

- **CSP** : `connect-src https://script.google.com` autorise n'importe quelle Web App Apps Script, donc un canal de sortie de données si une injection apparaissait un jour. Limiter au chemin exact (`https://script.google.com/macros/s/<id>/`), injecté par `scripts/injecter-config.sh` comme l'URL.
- **Journal** : aucune purge, et les lignes d'un compte supprimé gardent son pseudo. Prévoir une rotation (par exemple 30 jours) dans la même fonction que la purge du constat 5.
- **Session** : le jeton ne change jamais et l'expiration glisse : un jeton volé reste valable tant qu'il sert. Limite connue ; le proxy du constat 3 la lève.

## Ce qui a été vérifié et tient

| Sujet | Vérification |
|---|---|
| Autorité du serveur | Cartes, soldes, tours et montant de l'all-in décidés par le serveur. Aucune valeur du client n'est utilisée sans validation de type et de bornes. |
| Carte cachée, paquet | Absents de `tbVue()` pendant la phase de jeu. Paquet neuf mélangé à chaque manche, aléa cryptographique, tirage par rejet sans biais. |
| Double dépense, double gain | Mise relue et débitée sous verrou. Table sauvée avant les soldes : un gain ne peut pas être crédité deux fois. |
| Injection | Pseudo en liste blanche, formules neutralisées, corps limité à 1 Ko, routage par `hasOwnProperty`. Front sans `innerHTML`, Trusted Types actif. |
| Session | 244 bits d'aléa, seule l'empreinte est stockée, révoquée à la suppression malgré le cache. Cookie `__Host-`, `Secure`, `SameSite=Strict`. |
| Site publié | HSTS 1 an. `.git`, `backend/`, `tests/`, démo, `README.md` : non publiés. `app.js` publié identique à `main`. |
| API | GET refusé, `nosniff`, erreurs sans trace technique. CORS `*` sans risque : aucun identifiant envoyé automatiquement. |
| Chaîne d'approvisionnement | Aucune dépendance npm, polices auto-hébergées, actions épinglées par SHA, Dependabot. |

## Plan d'action proposé

| Priorité | Action | Rôle |
|---|---|---|
| 1 | Corriger `limiter_()` (constat 1) et le test associé | A + C |
| 2 | Release `develop` → `main`, redéployer, archiver les anciens déploiements (constat 2) | A |
| 3 | Sortir l'autre site de l'origine (constat 4) | C |
| 4 | Renouvellement de session sous verrou, purge des comptes expirés (constats 5, 6) | A |
| 5 | Pseudos, règle « quitter après rester », `CODEOWNERS` et réglages du dépôt (constats 7 à 9) | A + C |
| 6 | Décider : proxy devant l'API, ou documenter les limites dans cadrage §4.5 (constat 3) | Équipe |
