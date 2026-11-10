# Plan de recette

Responsable : **D**. À faire relire par **A** (back) et **C** (sécurité) avant de le dérouler.

Chaque scénario correspond à un critère d'acceptation de [cadrage.md §6](../cadrage.md#6-critères-dacceptation). Le cadrage en liste **9** (et non 8 comme l'annonce `repartition.md`) : tous sont couverts ici. Un critère n'est coché dans `cadrage.md` que si **tous** ses scénarios passent, preuve à l'appui.

## Préparation

| Élément | Valeur |
|---|---|
| Site testé | https://payzzttv.github.io/BlackjackB3/ (après le branchement de l'API par A) |
| Navigateurs | **Firefox**, **Chrome** (ou Edge), **Safari** ou un navigateur mobile. Au moins 3 navigateurs distincts pour R2. |
| Joueurs | `recette_a`, `recette_b`, `recette_c` (un par navigateur) |
| Accès au Sheet | **A uniquement**, qui lit les onglets pendant les scénarios R3 et R7 et envoie une capture |
| Outils | Outils de développement du navigateur (onglet Réseau), `curl`, Node 20+ |

**L'URL de l'API ne se colle jamais** dans ce fichier, une issue, une capture ou le chat. Pour `curl`, la mettre dans une variable de terminal :

```bash
read -rs BJ_API_URL   # coller l'URL, Entrée (rien ne s'affiche)
```

Une requête à l'API (Apps Script répond par une redirection, d'où `-L`) :

```bash
curl -sL -H 'Content-Type: text/plain' -d '{"action":"classement"}' "$BJ_API_URL"
```

**Preuves** : une capture ou la sortie de commande par scénario, rangées dans le dossier partagé de l'équipe, **en masquant les jetons et l'URL de l'API**. Résultat noté `OK`, `KO #n` (numéro de l'issue ouverte) ou `Bloqué`.

**Anomalie** : une issue par problème, étiquetée avec le rôle du dossier fautif (`A` ou `B`), titre `Recette Rn : <symptôme>`, avec étapes, résultat attendu, résultat obtenu et preuve. Après correction : rejouer le scénario et un test de non-régression est ajouté (voir [repartition.md](../repartition.md), tâche D).

---

## R1 · Inscription et session retrouvée

*Critère : un joueur s'inscrit avec un pseudo seul et retrouve sa session après fermeture du navigateur.*

| # | Étapes | Attendu |
|---|---|---|
| R1.1 | Firefox, fenêtre normale. Ouvrir le site, saisir `recette_a`, valider. | Écran de jeu, solde 1 000. Avertissement « votre cookie est votre compte » visible avant validation. |
| R1.2 | Fermer **complètement** le navigateur, le rouvrir, revenir sur le site. | Connecté directement en `recette_a`, même solde. |
| R1.3 | Outils de dév → Stockage → Cookies. | Un cookie `__Host-bj_session`, `Secure`, `SameSite=Strict`, sans `Domain`, `Path=/`, expiration ~30 jours. |
| R1.4 | Dans un 2e navigateur, essayer le pseudo `RECETTE_A`. | Refusé : « Ce pseudo est déjà pris. » (comparaison sans casse). |
| R1.5 | Essayer `ab`, `pseudo trop long123`, `é_test`, `croupier`. | Tous refusés avec un message clair, aucune inscription. |
| R1.6 | Fenêtre privée, s'inscrire `recette_tmp`, puis « Supprimer mon compte ». | Retour à l'inscription ; `recette_tmp` est de nouveau libre. |

## R2 · Deux navigateurs à la même table (en fait 3)

*Critère : deux navigateurs différents jouent à la même table, chacun à son tour, et voient les mains de l'autre.*

| # | Étapes | Attendu |
|---|---|---|
| R2.1 | `recette_a` (Firefox), `recette_b` (Chrome), `recette_c` (3e navigateur) s'assoient. | Chacun voit les 3 places occupées, avec les pseudos, en moins de ~3 s. |
| R2.2 | Seuls A et B misent 50. Attendre. | La distribution part 15 s après la 1re mise ; C reste assis sans main. |
| R2.3 | Pendant le tour de A, B clique sur « Tirer » (s'il est visible) ou tente l'action. | Les boutons de B sont inactifs ; aucune carte ne change chez B. |
| R2.4 | A tire une carte. | La nouvelle carte apparaît chez A **et** chez B et C ; elle ne disparaît jamais, même brièvement (non-régression de la course sondage / action). |
| R2.5 | A ne joue plus pendant 30 s. | A « reste » automatiquement ; le tour passe à B. |
| R2.6 | Manche suivante : les 3 misent. | La distribution part dès que le 3e a misé, sans attendre 15 s. |
| R2.7 | C ne mise pas pendant 3 manches. | C est levé de la table. |
| R2.8 | B quitte la table pendant sa main. | Main abandonnée, mise perdue ; impossible de récupérer la mise. |

## R3 · Solde correct et persistant

*Critère : le solde est correct après chaque manche et persiste dans le Sheet.*

Noter pour chaque manche : solde avant, mise, résultat, solde après. Le calcul attendu est fait **à la main**.

| # | Situation | Attendu |
|---|---|---|
| R3.1 | Mise 100, défaite | Solde − 100, débité **dès la mise** (avant la distribution). |
| R3.2 | Mise 100, victoire | Solde final = avant + 100. |
| R3.3 | Mise 100, égalité | Solde inchangé. |
| R3.4 | Mise 15, blackjack naturel (3:2, arrondi inférieur) | Solde final = avant + 22. Si le hasard ne le donne pas, A le vérifie dans le Journal d'une manche jouée en recette. |
| R3.5 | Mise 50, dépasser 21 | Perte immédiate, sans attendre le croupier. |
| R3.6 | Mise 500 puis 501 | 500 accepté, 501 refusé. Mise 9 refusée. |
| R3.7 | Recharger la page, puis A lit l'onglet `Joueurs`. | Même solde qu'à l'écran ; le `Journal` contient mise et gain de chaque manche. |
| R3.8 | Descendre sous 10 jetons, puis miser. | Solde remis à 1 000, `faillites` = 1 dans le Sheet. |

## R4 · Classement

*Critère : le classement affiche les 10 meilleurs soldes.*

| # | Étapes | Attendu |
|---|---|---|
| R4.1 | Ouvrir le classement. | Au plus 10 lignes, triées par solde décroissant, pseudo + solde seulement (aucun jeton, aucune date). |
| R4.2 | Faire varier le solde de `recette_a`, attendre 60 s. | Le classement est à jour (cache de 60 s). |
| R4.3 | `curl … '{"action":"classement"}'` | Même contenu que l'écran, et rien de plus. |

## R5 · Carte cachée jamais envoyée

*Critère : la carte cachée du croupier n'apparaît dans aucune réponse réseau avant la fin de la manche.*

| # | Étapes | Attendu |
|---|---|---|
| R5.1 | Outils de dév → Réseau, filtre `exec`, « conserver le journal ». Jouer une manche complète. | Tant que la phase est `jeu`, le croupier n'a qu'**une** carte visible dans chaque réponse ; aucun champ ne contient le paquet ou la 2e carte. |
| R5.2 | Exporter le journal réseau (HAR) et chercher la 2e carte du croupier une fois révélée. | Elle n'apparaît qu'à partir de la première réponse en phase `fin`. |
| R5.3 | Avec C : lancer le pentest automatique contre le site réel (`scripts/pentest.js`, voir `docs/pentest.md` sur `main`). | Aucun échec sur les tests de fuite. |

## R6 · Requêtes modifiées refusées

*Critère : une requête modifiée à la main (mise négative, action inconnue, jeton d'un autre, pas son tour) est refusée.*

À dérouler avec C. `JETON_A` et `JETON_B` sont lus dans les cookies de `recette_a` et `recette_b`, **jamais** recopiés ailleurs.

| # | Corps envoyé | Erreur attendue |
|---|---|---|
| R6.1 | `{"action":"miser","jeton":"<JETON_A>","mise":-50}` | `mise_invalide` |
| R6.2 | `{"action":"miser","jeton":"<JETON_A>","mise":"50"}` | `mise_invalide` (pas de chaîne) |
| R6.3 | `{"action":"miser","jeton":"<JETON_A>","mise":50.5}` | `mise_invalide` |
| R6.4 | `{"action":"crediter","jeton":"<JETON_A>"}` puis `{"action":"__proto__"}` et `{"action":"initialiser"}` | `action_inconnue` |
| R6.5 | `{"action":"etat","jeton":"<64 caractères hexa au hasard>"}` | `session_invalide` |
| R6.6 | Pendant le tour de A : `{"action":"tirer","jeton":"<JETON_B>"}` | `pas_ton_tour` |
| R6.7 | Inscription avec `{"action":"inscription","pseudo":"=IMPORTXML(\"x\",\"y\")"}` | `pseudo_invalide` ; rien dans le Sheet. |
| R6.8 | Corps de plus de 1 Ko, ou JSON cassé | `requete_invalide` |
| R6.9 | `curl -sL "$BJ_API_URL"` (GET) | `methode_non_autorisee` |
| R6.10 | Une erreur quelconque | Le message ne contient ni trace, ni nom de fonction, ni chemin. |

## R7 · Aucun jeton en clair dans le Sheet

*Critère : le Sheet ne contient aucun jeton en clair.*

| # | Étapes | Attendu |
|---|---|---|
| R7.1 | `recette_a` lit son jeton dans le cookie et le donne **oralement** à A (pas par écrit). A cherche cette valeur dans tout le classeur (Ctrl+F, tous les onglets). | Aucun résultat. |
| R7.2 | A calcule l'empreinte SHA-256 du jeton (`printf %s "<jeton>" \| sha256sum`) et la cherche. | Trouvée dans la colonne `jeton_hash` de `recette_a`, et seulement là. |
| R7.3 | A vérifie le partage du Sheet. | Partagé avec personne. |

## R8 · Tests automatiques verts

*Critère : `node --test "tests/*.test.js"` passe.*

| # | Étapes | Attendu |
|---|---|---|
| R8.1 | Sur un clone à jour de `develop`, puis de `main` : `node --test "tests/*.test.js"` | `fail 0`. Noter le nombre de tests (`tests N`) dans le rapport. |
| R8.2 | Onglet Actions de GitHub | Dernier workflow « Tests » vert sur `develop` et `main`. |

## R9 · URL de l'API hors du dépôt

*Critère : l'URL de l'API n'apparaît nulle part dans le dépôt ; elle vient du secret `BJ_API_URL`.*

| # | Étapes | Attendu |
|---|---|---|
| R9.1 | `git log -p --all \| grep -c "script.google.com/macros/s/AKfy"` | `0` (aucune URL de déploiement réelle dans tout l'historique). |
| R9.2 | Settings → Secrets and variables → Actions | Le secret `BJ_API_URL` existe. |
| R9.3 | Sur le site publié, ouvrir `config.js`. | Contient l'URL réelle (attendu : voir cadrage §4.4), alors que `frontend/config.js` dans git contient l'URL factice. |

---

## Rapport de recette

À remplir pendant la campagne, puis cocher les critères dans `cadrage.md` par une PR `docs/recette-resultats`.

| Scénario | Navigateur | Date | Testeur | Résultat | Preuve / issue |
|---|---|---|---|---|---|
| R1.1 | | | | | |
| … | | | | | |
