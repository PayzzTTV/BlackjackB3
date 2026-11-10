# Audit OWASP Top 10 : Blackjack B3

Responsable : **rôle C**. Référentiel : [OWASP Top 10 (2025)](https://owasp.org/Top10/). Complète le [pentest](pentest.md), qui rejoue les attaques sur l'API. Cet audit couvre ce que le pentest ne regarde pas : configuration, dépendances, logique métier, journalisation et gestion des erreurs.

## Campagne du 2026-11-10

- **Testeur** : rôle C (Alexis), exécution assistée par Claude Code
- **Version testée** : `main` @ `eb615a4` (site publié + Web App Apps Script redéployée le même jour)
- **Site** : https://payzzttv.github.io/BlackjackB3/
- **Méthode** :
  - en-têtes HTTP et fichiers exposés, avec `curl` ;
  - contrôles navigateur sur le site publié : CSP, Trusted Types, partage d'origine ;
  - revue du code de `main` ;
  - scénarios de logique métier rejoués sur le **back simulé** (`tests/faux-apps-script.js`) ;
  - pentest automatique du même jour : 21/21 OK.
- **Pas fait volontairement** :
  - aucun test de déni de service contre la prod ;
  - aucun compte créé depuis un navigateur sur la prod ;
  - le pentest manuel M01, M02 et M06 à M09 reste à faire ([pentest.md](pentest.md#grille-manuelle)).

## Synthèse

| # | Gravité | Catégorie | Constat | Statut |
|---|---|---|---|---|
| 1 | **Haute** | A06 Conception non sécurisée | Un attaquant **sans compte** fait prendre le verrou global à chaque sondage avec un jeton aléatoire : il peut bloquer toutes les actions de jeu (« serveur occupé »). Régression de la PR #55. | ✅ Corrigé (branche `fix/c-verrou-jetons-inconnus`), **à redéployer** |
| 2 | **Moyenne** | A02 Mauvaise configuration · A03 Chaîne d'approvisionnement | Un autre site GitHub Pages du compte (`/alexisdelburg.github.io/`) partage l'origine du jeu. Il charge 4 scripts de CDN tiers **sans SRI ni CSP**. Ces scripts peuvent lire le cookie de session des joueurs. | À corriger |
| 3 | Moyenne | A06 | **Squat de la table** : 5 comptes gratuits qui misent le minimum à chaque manche occupent la table indéfiniment. | À décider |
| 4 | Moyenne | A06 · A07 | **Quota global d'inscriptions épuisable** : 30 inscriptions d'un attaquant bloquent toute nouvelle inscription pendant 1 h. | À décider |
| 5 | Faible | A06 | **Classement sans valeur** : all-in sans plafond + renflouement illimité = 40 000 jetons atteints en 40 manches sans rien risquer (17 faillites renflouées). | À décider |
| 6 | Faible | A09 Journalisation et alertes | Les attaques refusées (jetons forgés, mises truquées, quotas dépassés) ne laissent **aucune trace**, et il n'y a aucune alerte. | À décider |
| 7 | Info | A02 | Pas de `frame-ancestors` possible sur GitHub Pages. L'anti-cadre en JavaScript est contournable avec `<iframe sandbox>`, mais le jeu ne fonctionne pas sans JavaScript : rien à piéger. | Accepté |

Aucune faille permettant de **tricher, d'usurper un joueur ou de lire des données d'un autre joueur** n'a été trouvée.

## Détail des constats

### 1. Verrou global pris par des jetons inconnus (Haute)

- **Où** : `authentifier_(jeton, true)` dans `backend/Code.gs`, appelé par `etat`. Sans fiche en cache, la lecture du Sheet se fait sous le verrou global (`avecVerrou_(…, 0)`) **avant** de savoir si le jeton existe.
- **Preuve** : sur le back simulé, 20 sondages avec des jetons aléatoires prennent le verrou 20 fois. En ligne, une lecture du Sheet dure 0,5 à 2 s.
- **Impact** : le quota par session ne protège pas, puisque chaque jeton aléatoire a son propre compteur. Une rafale de jetons inventés garde le verrou presque en permanence. Les actions de jeu attendent alors jusqu'à 10 s puis échouent (`serveur_occupe`), et les manches n'avancent plus. Avant la PR #55, ces requêtes coûtaient une lecture du Sheet mais ne prenaient pas le verrou.
- **Correctif** : le Sheet est d'abord lu **sans verrou**. Le verrou n'est pris (sans attendre) pour remettre la fiche en cache **que si le joueur existe**. Un jeton inconnu ne touche plus jamais au verrou. Coût : une 2e lecture du Sheet au plus une fois par joueur et par 30 min. Test de non-régression : « un jeton inconnu ne prend jamais le verrou global », qui échoue sur l'ancien code et passe avec le correctif.
- **En ligne** : le correctif n'agit qu'après redéploiement de `backend/Code.gs` sur Apps Script.

### 2. Origine partagée avec un site qui charge des scripts tiers (Moyenne)

- **Où** : `https://payzzttv.github.io/alexisdelburg.github.io/` est servi sur la **même origine** (`https://payzzttv.github.io`) que le jeu.
- **Preuve** : un cookie de test `__Host-owasp_preuve` posé depuis `/BlackjackB3/` a été **lu depuis l'autre site**, puis effacé. Cet autre site charge 3 scripts depuis `cdnjs.cloudflare.com` et 1 depuis `cdn.jsdelivr.net`, sans attribut `integrity` (SRI) et sans CSP.
- **Impact** : si l'un de ces CDN ou paquets est compromis, ou si ce site est modifié, son JavaScript peut lire `__Host-bj_session` chez tout joueur qui le visite, puis jouer et supprimer son compte. [cadrage.md §4.5](../cadrage.md#45-limites-connues-transparence) acceptait le partage d'origine **à condition de n'héberger aucune page non maîtrisée sur le compte** : cette condition n'est plus remplie.
- **Correctifs possibles**, du plus sûr au plus rapide :
  1. donner au jeu sa propre origine : domaine personnalisé dédié, ou publication depuis un compte ou une organisation GitHub dédiés ;
  2. déplacer l'autre site hors de ce compte ;
  3. au minimum, ajouter SRI et une CSP stricte à l'autre site.

### 3. Squat de la table (Moyenne)

- **Preuve** : 5 comptes créés en quelques secondes s'assoient et misent 10 à chaque manche. Après 6 manches, un vrai joueur reçoit toujours `table_pleine`. Le renflouement à 1 000 rend le squat gratuit et sans fin. L'éviction ne vise que les joueurs qui **ne misent pas** pendant 3 manches.
- **Pistes** : limiter le temps passé assis quand quelqu'un attend (rotation), ou une place par empreinte de navigateur. Rien n'est infaillible sans adresse IP (limite connue d'Apps Script).

### 4. Quota global d'inscriptions épuisable (Moyenne)

- **Preuve** : 30 inscriptions, puis celle d'un vrai joueur → `trop_de_requetes` pendant 1 h.
- **Contexte** : le quota existe pour empêcher l'inondation du Sheet. Faute d'adresse IP, il est global. C'est un compromis entre remplir le Sheet et bloquer les inscriptions.
- **Pistes** : relever le seuil et purger automatiquement les comptes jamais assis ; ou accepter et documenter dans §4.5.

### 5. Classement manipulable par all-in + renflouement (Faible)

- **Preuve** : 40 manches d'all-in donnent un solde maximum de 40 000, avec 17 faillites renflouées. Perdre ne coûte rien.
- **Pistes** : classer sur `solde − 1 000 × faillites`, ou afficher les faillites dans le classement, ou plafonner le nombre de renflouements par jour.

### 6. Attaques non journalisées (Faible)

- **Constat** : le Journal trace inscriptions, mises, gains et suppressions. Les refus (`session_invalide`, `mise_invalide`, `trop_de_requetes`…) ne laissent aucune trace : impossible de voir une attaque après coup.
- **Piste** : compter les refus par type dans `CacheService` et écrire un résumé dans le Journal au plus une fois par minute, pour ne pas ajouter d'écriture au Sheet à chaque requête.

## Contrôles par catégorie

| Catégorie OWASP 2025 | Résultat | Preuves |
|---|---|---|
| **A01** Contrôle d'accès défaillant | ✅ | Toute décision côté serveur. Jeton d'un autre, hors tour, sans être assis : refusés (P05, P07, P10). Compte supprimé = session révoquée malgré le cache (P15). Fonctions d'admin non appelables (P03). Sheet non partagé. CORS `*` sur l'API sans risque : aucun identifiant n'est envoyé automatiquement, le jeton voyage dans le corps de la requête. |
| **A02** Mauvaise configuration de sécurité | ⚠️ constats 2, 7 | HTTPS forcé (301 + HSTS 1 an). CSP stricte avec Trusted Types, vérifiée dans le navigateur : `innerHTML`, `fetch` externe et script externe bloqués. `no-referrer`. Aucun fichier sensible publié (`.git`, `backend/`, démo, sources : 404). API : `nosniff`, `X-Frame-Options`, GET refusé. |
| **A03** Chaîne d'approvisionnement logicielle | ⚠️ constat 2 | Aucune dépendance npm ni bibliothèque Apps Script. Polices hébergées sur le site. Actions GitHub épinglées par SHA, Dependabot, CodeQL, secret scanning + push protection (M10). |
| **A04** Défaillances cryptographiques | ✅ | Jeton de 244 bits d'aléa (2 UUID v4, générateur de Google). Seule l'empreinte SHA-256 est stockée : un hachage lent est inutile pour un secret de cette entropie. Cookie `__Host-`, `Secure`, `SameSite=Strict`. TLS partout. |
| **A05** Injection | ✅ | Pseudo limité à `[A-Za-z0-9_]{3,16}` (P04). Neutralisation des formules `= + - @` avant toute écriture dans le Sheet. Corps JSON de 1 Ko max (P02). Affichage uniquement par `textContent` / `createElement` (S03), garanti par Trusted Types. |
| **A06** Conception non sécurisée | ⚠️ constats 1, 3, 4, 5 | Le client n'a aucune autorité (cartes, soldes, tours). Mise débitée dès qu'elle est posée. Montant de l'all-in calculé par le serveur. Verrou contre la double dépense. |
| **A07** Défaillances d'authentification | ✅ (limites connues) | Pas de mot de passe par conception. Session de 30 j glissante. Quota par session (P14). Jeton jamais dans l'URL. Cookie non `HttpOnly` : limite connue (§4.5), compensée par la CSP. |
| **A08** Défaillances d'intégrité des logiciels et des données | ✅ | Le site n'est publié que depuis `main`, protégée (PR + 1 relecture + CI). URL de l'API dans un secret. Aucune désérialisation de données du client hors `JSON.parse` sur un objet validé. Ordre « table puis soldes » : aucun crédit en double possible. |
| **A09** Défaillances de journalisation et d'alerte | ⚠️ constat 6 | Journal d'audit dans le Sheet, lisible par le seul propriétaire. Erreurs internes dans les journaux Apps Script. |
| **A10** Mauvaise gestion des conditions exceptionnelles | ✅ | Messages d'erreur génériques, sans trace (P16). Verrou indisponible : refus propre (`serveur_occupe`). Échec d'écriture du cache : la fiche est retirée plutôt que laissée périmée. |
