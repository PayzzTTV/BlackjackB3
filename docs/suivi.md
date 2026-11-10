# Tableau de suivi

Responsable : **D**. Ce fichier sert de source pour le **GitHub Project « Blackjack B3 »** : une issue par tâche de [repartition.md](../repartition.md), assignée et étiquetée par rôle. Le Project fait foi pour les statuts ; ce fichier sert à le (re)créer et à l'animer.

## Mise en place (une fois, par D)

1. **Projects → New project → Board**, nom « Blackjack B3 », colonnes : `À faire`, `En cours`, `En relecture`, `Fait`.
2. Créer les étiquettes et les issues : à la main depuis le tableau ci-dessous, ou avec [GitHub CLI](https://cli.github.com/) (`gh auth login` d'abord) :

```bash
# Étiquettes (une par rôle + priorités de repartition.md)
gh label create A -c 1d76db -d "Back et déploiement Google"
gh label create B -c 0e8a16 -d "Front et expérience de jeu"
gh label create C -c b60205 -d "Sécurité et dépôt GitHub"
gh label create D -c 5319e7 -d "Qualité, coordination, livrables"
gh label create bloquant -c d93f0b -d "Bloque les autres tâches"
gh label create phase-2 -c fbca04 -d "Attend le site jouable"
gh label create bonus -c c5def5 -d "Si le temps le permet"
gh label create "après le projet" -c ededed -d "Idée hors périmètre (3 fonctionnalités figées)"
```

```bash
# Une issue par tâche (exemple ; répéter pour chaque ligne du tableau)
gh issue create --title "A · Créer le Sheet et la Web App" --label A,bloquant \
  --body "Voir repartition.md. Fini quand : l'autorisation Google ne demande que « ce classeur », et les onglets Joueurs et Journal existent."
```

3. Ajouter toutes les issues au Project, assigner chaque responsable, puis lier chaque PR à son issue (`Closes #n` dans la description) pour qu'elle passe en `Fait` toute seule.

## Les issues à créer

Statut relevé le 10/11/2026 d'après l'historique git (`develop` et `main`).

| Titre de l'issue | Étiquettes | Branche attendue | Statut |
|---|---|---|---|
| A · Créer le Sheet et la Web App | A, bloquant | (hors git) | À faire |
| A · Brancher le site (secret `BJ_API_URL`) | A, bloquant | (hors git) | À faire |
| A · Vérifier ce qui n'a jamais tourné en vrai | A, phase-2 | `fix/a-…` si besoin | À faire |
| A · Mesurer la charge à 5 joueurs | A, phase-2 | `fix/a-quotas` si besoin | À faire |
| A · Archiver le Journal | A, bonus | `feature/a-archivage` | À faire |
| B · Mode démo local | B, bonus | `feature/b-demo` | Fait (sur `develop`) |
| B · États de chargement | B | `feature/b-chargement` | Fait (#8) |
| B · Corriger la course sondage / action | B | `fix/b-course-sondage` | Fait (#9) |
| B · Mobile et accessibilité | B, phase-2 | `feature/b-accessibilite` | Clavier fait, test téléphone à faire |
| B · Aide intégrée | B | `feature/b-aide` | Fait (#10) |
| C · Protéger `main` et `develop` | C, bloquant | (réglages GitHub) | À vérifier : des commits sont arrivés directement sur `main` |
| C · Hygiène du dépôt | C | `feature/c-hygiene` | Fait sur `main` (#14), absent de `develop` |
| C · Pentest du site réel | C, phase-2 | `feature/c-pentest` | Grille prête (#13), à dérouler sur le site réel |
| C · Politique de sécurité (`SECURITY.md`) | C | `feature/c-hygiene` | Fait sur `main`, absent de `develop` |
| D · Tableau de suivi | D, bloquant | `feature/d-suivi` | En cours (ce fichier) |
| D · Plan de recette | D | `feature/d-plan-recette` | En cours |
| D · Recette | D, phase-2 | `fix/…` par anomalie | Attend A |
| D · Tests de non-régression | D | `feature/d-non-regression` | En cours |
| D · Soutenance | D, phase-2 | `feature/d-soutenance` | Support en préparation |
| Chacun · Prénom dans repartition.md | A / B / C / D | `docs/repartition-<role>` | D : fait |

## Points à remonter au point quotidien

- **`main` et `develop` ont divergé** : le travail de C (SECURITY.md, CodeQL, pentest, test d'épinglage des actions) est sur `main` mais pas sur `develop`, et tout le travail de B est sur `develop` mais pas sur `main`. Il faut fusionner `main` dans `develop` (branche `chore/synchro-main-develop` déjà ouverte) **avant** la prochaine PR `release`, sinon la CI de `develop` ne teste pas ce qui est en ligne.
- Ce qui précède montre que la protection des branches n'était pas active au moment de ces merges : à revérifier avec C.

## Le point quotidien (10 min, animé par D)

1. Chacun : fait hier, fait aujourd'hui, ce qui bloque (1 min chacun).
2. D met à jour les colonnes du Project en direct.
3. Tout blocage qui dépasse 1 jour devient une issue étiquetée `bloquant`, avec un responsable.
