# Répartition : ce qu'il reste à faire à 4

Le code est écrit, testé et publié sur GitHub, mais **le jeu ne tourne pas encore pour de vrai** : l'API Google (Sheet + Apps Script) n'est pas déployée. Le travail restant porte sur ce déploiement, la recette, le durcissement et la soutenance.

**On n'ajoute aucune fonctionnalité** : le périmètre reste à 3 (voir [cadrage.md](cadrage.md)).

| Rôle | Personne | Périmètre (dossiers possédés) |
|---|---|---|
| **A** Back et déploiement Google | _à attribuer_ | `backend/`, le Google Sheet, le déploiement Apps Script |
| **B** Front et expérience de jeu | _à attribuer_ | `frontend/` (sauf `config.js`) |
| **C** Sécurité et dépôt GitHub | Alexis | `.github/`, `SECURITY.md`, `docs/pentest.md` |
| **D** Qualité, coordination, livrables | _à attribuer_ | `tests/`, `README.md`, `cadrage.md`, soutenance |

> Mettez vos prénoms dans la colonne « Personne » via une PR. C'est la première PR de chacun.

---

## Système de branches

```
main ─────●──────────────────────────●──────────▶  production : déployée sur GitHub Pages
           \                         ↑ PR « release » (develop → main), relue par 2 personnes
develop ────●────●────────●────●────●──────────▶  intégration : tout le monde merge ici
             \   ↑         \   ↑
              \  PR         \  PR (relue par 1 personne d'un autre rôle, CI verte)
feature/a-…    ●──●          ●──●   une branche par tâche, partie de develop
```

| Branche | Rôle | Qui y pousse | Part de → revient dans |
|---|---|---|---|
| `main` | Version en ligne. Chaque merge redéploie le site. | **Personne en direct**, uniquement par PR | n/a |
| `develop` | Intégration : version de travail commune, toujours verte. | **Personne en direct**, uniquement par PR | `develop` → `main` |
| `feature/<role>-<sujet>` | Une tâche de ce fichier. Ex. `feature/b-chargement` | Son responsable | `develop` → `develop` |
| `fix/<role>-<sujet>` | Correction d'une anomalie de recette. Ex. `fix/a-pseudo-numerique` | Son responsable | `develop` → `develop` |
| `docs/<sujet>` | Documentation seule. Ex. `docs/pentest` | Tout le monde | `develop` → `develop` |
| `hotfix/<sujet>` | Urgence sur le site en ligne uniquement | Après accord de l'équipe | `main` → `main` **et** `develop` |

`<role>` vaut `a`, `b`, `c` ou `d`, `<sujet>` est court, en minuscules et avec des tirets.

### Le cycle d'une tâche

```bash
git switch develop
git pull
git switch -c feature/b-chargement
# ... travail, commits ...
git push -u origin feature/b-chargement
```

Puis sur GitHub : **Pull request vers `develop`** (jamais vers `main`), remplir le modèle, demander une relecture à quelqu'un d'un **autre rôle**, attendre la CI verte, fusionner en **Squash and merge** et supprimer la branche.

Si `develop` a avancé pendant votre travail : `git pull --rebase origin develop` sur votre branche, puis `git push --force-with-lease` (seulement sur **votre** branche de tâche).

### Mise en production

Quand `develop` est stable (recette OK sur ce qui a été ajouté) : PR **`develop` → `main`** intitulée `release: <résumé>`, relue par **2 personnes**, fusionnée en **Merge commit**. Le workflow Pages redéploie le site automatiquement.

### Messages de commit

Format court `type: description` en français :
`feat:` fonctionnalité · `fix:` correction · `test:` tests · `docs:` documentation · `sec:` sécurité · `ci:` workflows · `refactor:` sans changement de comportement.
Ex. `fix: ignorer les réponses de sondage périmées`.

### Protections (à configurer par C, Settings → Branches → Add rule)

| Règle | `main` | `develop` |
|---|---|---|
| PR obligatoire avant merge | ✅ | ✅ |
| Relectures requises | 2 | 1 |
| CI « Tests » verte exigée | ✅ | ✅ |
| Branche à jour avant merge | ✅ | ✅ |
| Annuler les approbations si nouveau commit | ✅ | ✅ |
| Force-push et suppression interdits | ✅ | ✅ |
| S'applique aussi aux admins | ✅ | ✅ |

---

## Où on en est

**Fait et vérifié**
- Front HTML/CSS/JS : table à 5 places, inscription par pseudo, classement
- Back Apps Script : sessions par cookie, logique de table côté serveur, quotas, verrous
- 37 tests Node verts (règles, table, attaques sur l'API)
- CI GitHub Actions verte, site en ligne sur https://payzzttv.github.io/BlackjackB3/
- URL de l'API gérée par le secret GitHub `BJ_API_URL`, `README.md` et `cadrage.md`

**Pas encore fait**
- Google Sheet et Web App Apps Script **jamais déployés** : le back n'a tourné que contre de faux services Google (tests)
- Secret `BJ_API_URL` pas créé, donc le site affiche « Configuration manquante »
- 2 PR Dependabot ouvertes (actions sous Node 20, dépréciées)
- Pas de protection de `main`, pas de recette multijoueur, rien de prêt pour la soutenance

---

## Ordre de marche

| Phase | Quoi | Qui |
|---|---|---|
| **0. Démarrage** (30 min, ensemble) | Chacun clone, passe sur `develop` et lance `node --test "tests/*.test.js"`. C protège `main` et `develop`. D crée le tableau de suivi. | Tous |
| **1. En parallèle, sans l'API** | A déploie l'API. B, C et D avancent sur ce qui n'en dépend pas. | Tous |
| **2. Site jouable** | Dès que A a branché le secret : tests réels, pentest, corrections. | Tous |
| **3. Recette et soutenance** | Tous les critères du cadrage cochés, démo répétée à 4. | D pilote |

Légende des tâches : 🔴 **bloquant** (bloque les autres) · 🟡 **phase 2** (attend le site jouable) · 🟢 **bonus** (si le temps le permet)

---

## A : Back et déploiement Google

Seule personne à toucher au Sheet et au compte Google de déploiement.

- [ ] 🔴 **Créer le Sheet et la Web App** : suivre le [README](README.md#1-le-google-sheet-et-lapi-5-minutes). Coller les 3 fichiers `.gs` et le manifeste, lancer `initialiser()`, déployer (*Exécuter en tant que : moi*, *Accès : tout le monde*). Ne partager le Sheet avec personne.
  *Fini quand :* l'autorisation Google ne demande que « ce classeur », et les onglets `Joueurs` et `Journal` existent.
- [ ] 🔴 **Brancher le site** : créer le secret `BJ_API_URL` (Settings → Secrets and variables → Actions), relancer le workflow « Déploiement GitHub Pages », prévenir l'équipe. **Ne jamais coller l'URL dans un commit, une issue ou le chat du groupe.**
  *Fini quand :* on peut s'inscrire et miser sur le site publié.
- [ ] 🟡 **Vérifier ce qui n'a jamais tourné en vrai** : redirection CORS vers `script.googleusercontent.com`, pseudo numérique comme `007` (doit rester du texte), recherche par jeton, verrou, cache.
  *Fini quand :* le Journal trace l'inscription, la mise et le gain d'une vraie manche.
- [ ] 🟡 **Mesurer la charge** : 5 onglets ouverts qui interrogent l'API en continu. Relever le temps de réponse de `etat`, voir si les quotas Google tiennent, ajuster `INTERVALLE_MS` (`frontend/config.js`) et `MAX_REQUETES_MINUTE` (`backend/Code.gs`) si besoin.
  *Fini quand :* une manche à 5 joueurs se joue sans erreur « serveur occupé ».
- [ ] 🟢 **Archiver le Journal** : fonction d'archivage + déclencheur hebdomadaire pour que l'onglet ne grossisse pas sans fin.

## B : Front et expérience de jeu

Règle d'or de `app.js` : **jamais d'`innerHTML`**, uniquement `textContent` / `createElement` (sinon la CSP Trusted Types bloque tout).

- [ ] 🟢 **Mode démo local** (utile dès la phase 1) : une page de démo avec un faux `fetch` qui renvoie une table d'exemple, pour travailler l'interface sans attendre l'API.
  *Fini quand :* on voit une table en cours de partie en local.
- [ ] **États de chargement** : Apps Script met 1 à 3 s à répondre au premier appel. Ajouter un indicateur pendant les actions, et un message clair si le serveur est lent ou injoignable.
  *Fini quand :* aucun clic ne paraît « mort ».
- [ ] **Corriger la course sondage / action** : une réponse de sondage partie *avant* un clic peut écraser l'affichage plus récent. Numéroter les requêtes et ignorer les réponses périmées.
  *Fini quand :* après « Tirer », la nouvelle carte ne disparaît jamais, même brièvement.
- [ ] 🟡 **Mobile et accessibilité** : test sur téléphone, navigation au clavier, focus visible, annonce « À vous de jouer » lue par les lecteurs d'écran.
  *Fini quand :* une manche se joue entièrement au clavier et sur un écran de 375 px.
- [ ] **Aide intégrée** : rappel des règles, et avertissement « votre cookie est votre compte » sur l'écran d'inscription.

## C : Sécurité et dépôt GitHub

Doit avoir le rôle **Admin** sur le dépôt.

- [ ] 🔴 **Protéger `main` et `develop`** (phase 0) : appliquer le tableau « Protections » du [système de branches](#système-de-branches). Mettre `develop` comme branche par défaut du dépôt (Settings → General), pour que les PR la ciblent d'office.
  *Fini quand :* un push direct sur `main` ou `develop` est refusé.
- [ ] **Hygiène du dépôt** : activer *secret scanning* et *push protection*. Relire puis fusionner les 2 PR Dependabot. Épingler les actions par SHA de commit. Ajouter un workflow CodeQL (JavaScript).
  *Fini quand :* l'onglet Security ne montre aucune alerte ouverte.
- [ ] 🟡 **Pentest du site réel** : dérouler la grille du [cadrage.md §4](cadrage.md#4-sécurité--le-cœur-du-projet) avec les outils de développement et `curl`. Points à tester : carte cachée visible dans l'onglet Réseau, jeton forgé, mise négative ou envoyée en texte, action hors de son tour, pseudo `=IMPORTXML(...)`, XSS via pseudo, page mise dans une iframe, flood d'inscriptions.
  *Fini quand :* `docs/pentest.md` liste chaque attaque, son résultat et une preuve (capture ou requête).
- [ ] **Politique de sécurité** : `SECURITY.md` (comment signaler une faille, limites connues : voir [cadrage.md §4.5](cadrage.md)).

## D : Qualité, coordination et livrables

Anime le point quotidien de 10 min.

- [ ] 🔴 **Tableau de suivi** (phase 0) : un GitHub Project avec une issue par tâche de ce fichier, assignée et étiquetée `A`, `B`, `C` ou `D`.
  *Fini quand :* chaque tâche a un responsable et un statut.
- [ ] **Plan de recette** : transformer les 8 critères d'acceptation du [cadrage.md §6](cadrage.md#6-critères-dacceptation) en scénarios pas à pas, dont une partie jouée sur 3 navigateurs différents.
  *Fini quand :* le plan est relu par A et C.
- [ ] 🟡 **Recette** : dérouler les scénarios sur le site publié, ouvrir une issue par anomalie, revérifier après correction.
  *Fini quand :* les 8 critères sont cochés dans `cadrage.md`.
- [ ] **Tests de non-régression** : un test par correction de A ou B (ex. course sondage / action), pour que la CI la garde.
- [ ] 🟡 **Soutenance** (phase 3) : support, scénario de démo à plusieurs joueurs, et avec C une démonstration d'attaque bloquée en direct. Captures d'écran et URL du site dans le README.
  *Fini quand :* démo répétée à 4 au moins une fois, avec un plan B si le réseau tombe.

---

## Qui attend qui

| Tâche | Attend | En attendant |
|---|---|---|
| Toute la phase 2 (B mobile, C pentest, D recette) | A : site branché sur l'API | B en mode démo, C sur GitHub, D sur le plan de recette |
| Fusion de toute PR | C : protection de `main` et `develop` active | Travailler sur sa branche |
| Mise en ligne d'une correction | PR `develop` → `main` relue par 2 personnes | Elle est déjà testable sur `develop` en local |
| Recette finale (D) | Corrections de A et B, rapport de C | Recette partielle des critères déjà prêts |
| Soutenance (D) | Recette verte | Préparer le support et le scénario |

## Règles de travail à 4

1. **Une branche par tâche**, nommée selon le [système de branches](#système-de-branches) (`feature/b-chargement`…), PR vers `develop` relue par quelqu'un d'un **autre rôle**, CI verte avant fusion. Jamais de travail directement sur `main` ou `develop`.
2. **Chacun reste dans ses dossiers.** Une modification hors de son périmètre passe par une PR relue par le responsable du dossier.
3. **Aucun secret dans git** : ni URL d'API, ni identifiants `clasp`, ni jeton. L'URL vit dans le secret `BJ_API_URL`, et un test de la CI bloque l'erreur.
4. **Une seule personne (A) a les droits** sur le Sheet et le déploiement Apps Script. Les autres testent via le site.
5. **Périmètre figé à 3 fonctionnalités** : toute idée nouvelle va dans une issue étiquetée « après le projet ».
