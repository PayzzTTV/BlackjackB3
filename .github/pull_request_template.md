## Quoi

<!-- En une ou deux phrases : ce que change cette PR. Lien vers l'issue : Closes #... -->

## Rôle et type

- Rôle : A / B / C / D
- Branche : `feature/…` · `fix/…` · `docs/…` · `hotfix/…` → cible `develop` (seule une release cible `main`)

## Vérifications

- [ ] La CI « Tests » est verte
- [ ] Testé à la main (expliquer comment ci-dessous)
- [ ] Aucun secret dans le diff (URL d'API, identifiants clasp, jeton)
- [ ] Front : pas d'`innerHTML`, `outerHTML`, `insertAdjacentHTML` ni `eval`
- [ ] Back : toute nouvelle entrée est validée côté serveur (type, bornes)
- [ ] Reste dans le périmètre des 3 fonctionnalités
- [ ] Doc mise à jour si besoin (`README.md`, `cadrage.md`, `repartition.md`)

## Comment tester

<!-- Étapes pour que la personne qui relit puisse vérifier. -->
