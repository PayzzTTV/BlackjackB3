# Soutenance

Responsable : **D**, avec **C** pour la démonstration d'attaque. Durée visée : **15 min** de présentation + questions (à ajuster selon la consigne).

*Fini quand :* démo répétée à 4 au moins une fois, avec un plan B si le réseau tombe (voir [repartition.md](../repartition.md)).

## Déroulé et prise de parole

| Temps | Partie | Qui | Contenu |
|---|---|---|---|
| 0:00 | Le projet en une phrase | D | Un blackjack multijoueur dans le navigateur, données dans un Google Sheet, **sécurité d'abord**. 3 fonctionnalités, pas une de plus. |
| 1:00 | Architecture | A | Schéma du [cadrage §3](../cadrage.md#3-architecture) : front statique sur GitHub Pages, Apps Script comme arbitre, Sheet privé. Pourquoi Apps Script est indispensable (sans lui, il faudrait rendre le Sheet public ou mettre une clé dans la page). |
| 3:00 | **Démo de jeu** à 3 joueurs | B pilote, A et D jouent | Scénario ci-dessous. |
| 7:00 | Sécurité : le modèle de menaces | C | « Le navigateur n'a aucune autorité » + 3 exemples : carte cachée, sessions hachées, injection de formule. |
| 9:00 | **Démo d'attaque bloquée** en direct | C | Scénario ci-dessous. |
| 11:00 | Qualité et méthode | D | Tests sans dépendance qui exécutent le vrai code `.gs`, CI, système de branches et protections, tableau de suivi, recette. |
| 13:00 | Limites assumées et suite | D | [cadrage §4.5](../cadrage.md#45-limites-connues-transparence) : cookie non `HttpOnly`, origine partagée `github.io`, temps réel par interrogation, perte du cookie = perte du compte. |
| 14:00 | Conclusion | D | Ce que chacun a appris (une phrase par personne). |

## Support (une diapo par ligne)

1. **Titre** : Blackjack B3, les 4 prénoms et rôles, URL du site.
2. **Le besoin** : 3 fonctionnalités (F1 pseudo, F2 table à 5, F3 top 10) et l'exigence « personne ne triche ».
3. **Architecture** : le schéma du cadrage, redessiné.
4. **Une manche** : le cycle mises → jeu → fin, avec les délais (8 s pour miser, 15 s par tour, 5 s de résultats).
5. **Le client n'a aucune autorité** : tableau menace → mesure (cadrage §4.1), 4 lignes maximum.
6. **Sessions sans mot de passe** : jeton de 244 bits, seule l'empreinte SHA-256 est stockée, cookie `__Host-` `Secure` `SameSite=Strict`.
7. **Entrées et sorties** : pseudo en liste blanche, neutralisation `= + - @`, aucun `innerHTML`, CSP + Trusted Types.
8. **Moindre privilège** : scope `spreadsheets.currentonly`, Sheet non partagé, URL de l'API dans un secret GitHub.
9. **Qualité** : capture de la CI verte, nombre de tests, exemple de test d'attaque, test de non-régression.
10. **Méthode** : schéma des branches, capture du GitHub Project.
11. **Recette** : les 9 critères du cadrage cochés, avec une preuve marquante (journal réseau sans carte cachée).
12. **Limites assumées**.
13. **Questions**.

Captures à prendre pendant la recette : écran d'inscription, table à 3 joueurs en cours, classement, onglet Réseau sans carte cachée, réponse `pas_ton_tour` à une requête forgée, onglet `Joueurs` du Sheet avec la colonne `jeton_hash` (**jetons masqués**), CI verte.

## Scénario de démo de jeu (4 min)

Préparé la veille : comptes `demo_a` (A), `demo_b` (B) et `demo_d` (D) déjà inscrits sur 3 navigateurs différents, assis à la table. **Aucun autre joueur** pendant la démo (prévenir la classe que le site est en démo).

1. B projette son navigateur. Montrer rapidement l'inscription avec un nouveau pseudo dans une fenêtre privée (F1), puis revenir à `demo_b`.
2. Les 3 misent : la distribution part dès la 3e mise.
3. À son tour, chacun tire ou reste ; la carte du joueur actif apparaît sur l'écran projeté (F2, tout le monde voit les mains de tout le monde).
4. Fin de manche : le croupier retourne sa carte cachée, les soldes changent.
5. Ouvrir le classement (F3).
6. Recharger la page : la session est retrouvée sans mot de passe.

## Scénario d'attaque bloquée (2 min, C)

À préparer avec C à partir de la grille de pentest (`docs/pentest.md` sur `main`). Proposition :

1. **Voir la carte cachée** : outils de dév → Réseau, ouvrir une réponse `etat` pendant le tour d'un joueur : le croupier n'a qu'une carte.
2. **Jouer à la place d'un autre** : rejouer la requête « Tirer » (clic droit → *Copier en tant que fetch*) dans la console, pendant le tour d'un autre joueur → `pas_ton_tour`.
3. **Mise truquée** : même requête avec `"mise": -500` puis `"mise": "500"` → `mise_invalide`.
4. **XSS / formule** : s'inscrire avec `<img src=x onerror=alert(1)>` ou `=IMPORTXML(...)` → `pseudo_invalide`.

Le jeton visible dans la console doit être celui d'un **compte de démo jetable**, supprimé juste après la soutenance.

## Plan B si le réseau ou Google tombe

| Problème | Plan B |
|---|---|
| Pas de réseau, ou Apps Script ne répond pas | **Mode démo local** : `frontend/demo.html` (faux serveur dans la page, aucune donnée envoyée). Servir le dossier avec `npx serve frontend` **avant** la soutenance sur l'ordinateur de présentation, et avoir Node installé. Le panneau de démo simule aussi un serveur lent ou injoignable. |
| Le mode démo ne marche pas non plus | **Vidéo** de la démo de jeu et de l'attaque, enregistrée pendant la répétition générale, sur une clé USB et dans le dossier partagé. |
| Le vidéoprojecteur ne prend pas le navigateur | Captures d'écran intégrées au support (diapos 9 à 11). |
| Quotas Google « serveur occupé » | Ne pas recharger en boucle ; passer au mode démo. |

## Liste de contrôle

**J-2 : répétition générale à 4**
- [ ] Déroulé complet chronométré, sous 15 min.
- [ ] Démo de jeu et d'attaque jouées sur le site réel, **et** en mode démo.
- [ ] Vidéo de secours enregistrée.
- [ ] Support relu par tout le monde.

**J-1**
- [ ] Recette verte : les 9 critères cochés dans `cadrage.md`.
- [ ] PR `release` `develop` → `main` fusionnée, site à jour.
- [ ] Comptes de démo créés et assis à la table.
- [ ] `npx serve frontend` testé sur l'ordinateur de présentation.

**Jour J**
- [ ] Navigateurs ouverts, onglets inutiles fermés, notifications coupées.
- [ ] Zoom du navigateur à 125 % pour la lisibilité.
- [ ] Après la soutenance : supprimer les comptes de démo.
