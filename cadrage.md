# Cadrage : Blackjack B3

## 1. Objectif

Un **blackjack multijoueur** jouable dans le navigateur, **volontairement simple** (3 fonctionnalités), avec les données dans un **Google Sheet** et une exigence non négociable : **la sécurité**. Personne ne doit pouvoir tricher, usurper un autre joueur ni lire des données qui ne le concernent pas.

## 2. Périmètre fonctionnel (3 fonctionnalités, pas une de plus)

| # | Fonctionnalité | Description |
|---|----------------|-------------|
| F1 | **Inscription par pseudo** | Le joueur choisit un pseudo, **sans mot de passe**. Il est inscrit dans le Google Sheet avec 1 000 jetons et reçoit un **cookie de session** valable 30 jours (renouvelé à chaque visite). |
| F2 | **Table multijoueur** | Une table partagée de **5 places**. Chaque joueur assis mise (10 à 500 jetons) puis joue **à son tour** contre le croupier (Tirer / Rester). Tout le monde voit les mains de tout le monde, mises à jour toutes les ~2,5 s. |
| F3 | **Classement** | Top 10 des joueurs par solde. |

### Déroulement d'une manche

```
 mises ──(tous ont misé, ou 8 s après la 1re mise)──▶ jeu ──(tous ont joué)──▶ fin ──(5 s)──▶ mises
                                                      │
                                     chaque joueur à son tour, 15 s max
                                     (au-delà, il « reste » automatiquement)
```

### Règles retenues
- Un **paquet de 52 cartes neuf, mélangé à chaque manche**.
- Le croupier **reste sur tous les 17**. Sa 2e carte est **cachée** pendant que les joueurs jouent.
- Blackjack naturel payé **3:2** (arrondi inférieur), victoire 1:1, égalité remboursée.
- Blackjack du croupier : la manche est réglée immédiatement.
- Atteindre 21 fait rester automatiquement ; dépasser 21 fait perdre immédiatement.
- **Quitter la table** : une mise pas encore distribuée est remboursée, une main en cours est **abandonnée** (mise perdue). Impossible de fuir une main perdante.
- Un joueur qui ne mise pas pendant **3 manches** est levé de la table.
- **Faillite** : sous 10 jetons, le solde est remis à 1 000 à la mise suivante (compteur `faillites`).
- **Se déconnecter = supprimer son compte** : sans mot de passe, il n'existe pas d'autre moyen de revenir sur un pseudo.

### Hors périmètre (assumé)
Split, doublement, assurance, plusieurs tables ou salons, chat, mot de passe ou récupération de compte, connexion Google/OAuth, application mobile.

## 3. Architecture

```
┌──────────────────────────┐   POST JSON (HTTPS)   ┌──────────────────────────────┐
│  Front statique          │ ────────────────────▶ │  Google Apps Script          │
│  HTML / CSS / JS vanilla │                       │  Web App attachée au Sheet   │
│  GitHub Pages            │ ◀──────────────────── │  = l'arbitre de la partie    │
│  cookie __Host-bj_session│   vue publique        │  - cartes, tours, soldes     │
└──────────────────────────┘                       │  - sessions, quotas, verrous │
                                                   └───────┬───────────────┬──────┘
                                                           │               │
                                             ┌─────────────▼────┐  ┌───────▼─────────────┐
                                             │ Google Sheet     │  │ Script Properties   │
                                             │ (privé)          │  │ état de la table    │
                                             │ Joueurs, Journal │  │ (paquet, mains...)  │
                                             └──────────────────┘  └─────────────────────┘
```

### Pourquoi Apps Script est indispensable
Sans code côté serveur, le navigateur devrait écrire directement dans le Sheet. Il faudrait alors soit rendre le Sheet modifiable publiquement, soit embarquer une clé d'accès dans la page. Dans les deux cas, n'importe qui pourrait s'attribuer des jetons, voir les cartes ou se faire passer pour un autre joueur. Apps Script est un petit script **attaché au Sheet** : pas de serveur à héberger, et le Sheet reste privé.

### Données

**Onglet `Joueurs`** (Google Sheet)

| pseudo | pseudo_norm | jeton_hash | jeton_expire | solde | faillites | cree_le | maj_le |
|---|---|---|---|---|---|---|---|

**Onglet `Journal`** (audit) : `date | pseudo | evenement | detail` (inscriptions, mises, gains, remboursements, suppressions).

**État de la table** : JSON dans les *Script Properties*. Il contient le paquet et la carte cachée et n'est **jamais** envoyé tel quel au client.

### API (une seule URL, POST uniquement)

| Action | Paramètres | Effet |
|---|---|---|
| `inscription` | `pseudo` | Crée le joueur, renvoie le jeton de session |
| `etat` | `jeton` | Vue publique de la table + mon solde (interrogé en boucle) |
| `asseoir` / `quitter` | `jeton` | Prendre / libérer une place |
| `miser` | `jeton`, `mise` | Miser pendant la phase de mises |
| `tirer` / `rester` | `jeton` | Jouer son tour |
| `supprimerCompte` | `jeton` | Supprime le compte, libère le pseudo |
| `classement` | n/a | Top 10 (pseudo + solde) |

## 4. Sécurité : le cœur du projet

### 4.1 Le client n'a aucune autorité
Le navigateur **affiche** et **transmet des intentions**. Toutes les décisions sont prises par Apps Script.

| Menace | Mesure |
|---|---|
| Voir la carte cachée ou les prochaines cartes | Paquet et mains conservés côté serveur. La vue envoyée au client exclut le paquet et la 2e carte du croupier jusqu'à la fin de la manche (testé). |
| Modifier son solde, ses gains, sa mise | Soldes calculés et écrits uniquement par le serveur. La mise est **débitée dès qu'elle est posée**. |
| Jouer à la place d'un autre / hors de son tour | Chaque action est rattachée au jeton de session ; le serveur vérifie que c'est bien le tour de ce joueur. |
| Fuir une main perdante | Quitter pendant sa main = mise perdue. Inaction = « rester » automatique après 15 s. |
| Mélange prévisible | Aléa issu de `Utilities.getUuid()` (UUID v4, générateur cryptographique) passé dans SHA-256, puis **Fisher-Yates avec tirage par rejet** (aucun biais modulo, testé par un khi²). `Math.random()` n'est jamais utilisé. |
| Double dépense / requêtes simultanées | Toute écriture passe sous `LockService` (verrou global). La table est sauvegardée **avant** les crédits : une panne peut faire perdre un gain (tracé au Journal) mais jamais créditer deux fois. |

### 4.2 Sessions sans mot de passe
| Menace | Mesure |
|---|---|
| Deviner un jeton | Jeton aléatoire de **244 bits** (2 UUID v4). |
| Fuite du Sheet → vol de sessions | Seule l'**empreinte SHA-256** du jeton est stockée. Avec une copie du Sheet, on ne peut usurper personne. |
| Vol du cookie par un autre site | Cookie `__Host-bj_session` : `Secure` (HTTPS uniquement), `SameSite=Strict` (jamais envoyé depuis un autre site), préfixe `__Host-` (pas de `Domain`, `Path=/`, impossible à écraser depuis un sous-domaine). |
| Vol du cookie par injection de script (XSS) | Aucune injection HTML possible (voir 4.3) + CSP stricte + Trusted Types. |
| CSRF | Le jeton voyage dans le corps de la requête, pas en cookie vers l'API : un site tiers ne peut pas agir à la place du joueur. |
| Session éternelle | Expiration 30 jours, glissante. La suppression du compte révoque immédiatement la session. |
| Squat massif de pseudos | 30 inscriptions par heure maximum (global). Pseudos système réservés (`croupier`, `admin`…). |
| Saturation (DoS applicatif) | 90 requêtes par minute et par session, corps limité à 1 Ko, classement mis en cache 60 s. |

### 4.3 Entrées et sorties
| Menace | Mesure |
|---|---|
| Injection de formule dans le Sheet (`=IMPORTXML(...)`) | Pseudo restreint à `[A-Za-z0-9_]{3,16}`, colonnes texte au format « texte brut », et neutralisation de toute valeur commençant par `= + - @` avant écriture. |
| Requêtes forgées | JSON strict, liste blanche d'actions (`__proto__`, `constructor`, fonctions d'admin refusés), types et bornes vérifiés (mise entière de 10 à 500, pas de chaîne `"50"`). |
| Fuite d'informations par les erreurs | Codes d'erreur métier uniquement ; toute exception interne devient « Erreur interne » (la trace ne va que dans les logs du propriétaire). |
| XSS via un pseudo | Le front n'utilise **jamais** `innerHTML` : uniquement `textContent` / `createElement`. Trusted Types (`require-trusted-types-for 'script'`) fait bloquer par le navigateur toute tentative d'écriture HTML brute. |
| Script tiers, CDN compromis | **Aucune dépendance.** CSP : `default-src 'none'; script-src 'self'; connect-src` limité à Google Apps Script ; `object-src`, `base-uri` et `form-action` à `'none'`. |
| Clickjacking | La page refuse de fonctionner dans un cadre (`frame-ancestors` est impossible via `<meta>`). |
| Fuite d'URL | `Referrer-Policy: no-referrer` ; aucune donnée en paramètre d'URL ; `doGet` refusé. |

### 4.4 Moindre privilège et secrets
- Scope OAuth unique : `spreadsheets.currentonly` (le script ne peut toucher **que** son propre Sheet).
- Le Sheet n'est partagé avec personne ; seul le script (exécuté sous l'identité du propriétaire) y accède.
- **Aucun secret dans le dépôt.** L'URL de la Web App est stockée dans le **GitHub Secret `BJ_API_URL`** et injectée dans `config.js` uniquement au déploiement. L'injection passe par une variable d'environnement (pas d'interpolation dans le script, donc pas d'injection de commande) et une liste blanche stricte du format. Un test de la CI échoue si une vraie URL est commitée. Il n'y a ni clé d'API ni compte de service.
- *Remarque :* une fois publiée, l'URL est forcément lisible dans le `config.js` servi aux navigateurs, car c'est l'adresse que le jeu appelle. Le secret évite qu'elle traîne dans le code source et l'historique git, et permet de la changer sans commit. La sécurité de l'API, elle, ne repose pas sur le secret de cette URL : elle repose sur les contrôles côté serveur (§4.1 à 4.3).
- Fonctions d'administration (`initialiser`, `reinitialiserTable`) lançables uniquement depuis l'éditeur Apps Script.
- Dependabot surveille les GitHub Actions ; la CI exécute les tests à chaque push.

### 4.5 Limites connues (transparence)
- **Le cookie n'est pas `HttpOnly`** : GitHub Pages est statique, aucun serveur ne peut le poser. Il est donc lisible par le JavaScript de la page. La protection repose sur l'absence d'injection possible (CSP, Trusted Types, `textContent`).
- **Toutes les pages GitHub Pages d'un même compte partagent l'origine** `<compte>.github.io`. Un autre dépôt du même compte pourrait lire le cookie : n'héberger aucune page non maîtrisée sur ce compte (ou utiliser un domaine personnalisé dédié).
- **Pas d'adresse IP côté Apps Script** : les quotas sont par session et globaux, pas par IP.
- **Sans mot de passe, perdre son cookie = perdre son compte** (navigation privée, effacement des cookies, autre appareil). C'est le prix de la simplicité demandée.
- **Temps réel par interrogation** (toutes les ~2,5 s) : Apps Script ne propose pas de WebSocket. Les quotas Google conviennent à quelques tables d'amis, pas à un usage massif.
- Pas de bcrypt/argon2 nécessaire : aucun mot de passe n'est stocké.

## 5. Livrables

| Livrable | Emplacement |
|---|---|
| Cadrage | `cadrage.md` (ce fichier) |
| Installation et utilisation | `README.md` |
| Front | `frontend/` (`index.html`, `style.css`, `app.js`, `config.js`) |
| Back Apps Script | `backend/` (`Code.gs`, `Table.gs`, `Blackjack.gs`, `appsscript.json`) |
| Tests | `tests/` (Node, zéro dépendance : règles, table, API et sécurité) |
| CI + déploiement du front | `.github/workflows/` (tests + GitHub Pages) |

## 6. Critères d'acceptation

- [ ] Un joueur s'inscrit avec un pseudo seul et retrouve sa session après fermeture du navigateur.
- [ ] Deux navigateurs différents jouent à la même table, chacun à son tour, et voient les mains de l'autre.
- [ ] Le solde est correct après chaque manche et persiste dans le Sheet.
- [ ] Le classement affiche les 10 meilleurs soldes.
- [ ] La carte cachée du croupier n'apparaît dans **aucune** réponse réseau avant la fin de la manche.
- [ ] Une requête modifiée à la main (mise négative, action inconnue, jeton d'un autre, pas son tour) est refusée.
- [ ] Le Sheet ne contient aucun jeton en clair.
- [ ] `node --test "tests/*.test.js"` passe (37 tests).
- [ ] L'URL de l'API n'apparaît nulle part dans le dépôt ; elle vient du secret `BJ_API_URL`.
