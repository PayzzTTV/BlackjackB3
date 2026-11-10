# Politique de sécurité

La sécurité est l'exigence n° 1 de Blackjack B3 (voir [cadrage.md §4](cadrage.md#4-sécurité--le-cœur-du-projet)). Merci de signaler toute faille de façon responsable.

## Version couverte

| Version | Couverte |
|---|---|
| Branche `main` (site en ligne) | ✅ |
| Branche `develop` | ✅ |
| Autres branches | ❌ |

## Signaler une faille

**N'ouvrez pas d'issue publique** pour une faille : elle serait visible de tous avant correction.

1. Allez dans l'onglet **Security** du dépôt → **Report a vulnerability** (signalement privé GitHub).
2. Décrivez :
   - ce que l'attaque permet (tricher, usurper un joueur, lire des données…) ;
   - les étapes pour la reproduire (requête envoyée, réponse obtenue) ;
   - l'impact estimé et, si vous en avez une, une piste de correction.
3. N'incluez **aucun jeton de session réel** ni l'URL de l'API dans le rapport.

Nous accusons réception sous **72 h** et visons une correction sous **14 jours**, par une branche `hotfix/…` (voir [repartition.md](repartition.md#système-de-branches)). La personne qui signale est créditée dans la correction si elle le souhaite.

## Dans le périmètre

- Triche : voir la carte cachée du croupier, prédire le paquet, modifier son solde ou ses gains, jouer hors de son tour, fuir une main perdante.
- Usurpation : utiliser ou deviner la session d'un autre joueur, prendre son pseudo.
- Injection : XSS dans le front, injection de formule dans le Google Sheet, injection dans les workflows GitHub.
- Fuite de données : accès au Sheet, aux empreintes de jetons, au Journal, à des traces d'erreur internes.
- Contournement des quotas (inscriptions, requêtes par session).

## Hors périmètre

Ces points sont des **limites connues et assumées**, documentées dans [cadrage.md §4.5](cadrage.md#45-limites-connues-transparence) :

- Le cookie de session n'est pas `HttpOnly` (GitHub Pages est statique).
- Un autre dépôt GitHub Pages du même compte partage l'origine `<compte>.github.io`.
- Les quotas ne sont pas appliqués par adresse IP (Apps Script ne la fournit pas).
- Perdre son cookie fait perdre son compte (il n'y a pas de mot de passe).
- L'URL de la Web App est lisible dans le `config.js` publié : c'est l'adresse que le jeu appelle.
- Les dénis de service volumétriques contre l'infrastructure Google ou GitHub.

## Règles pour les tests

- Testez avec **vos propres comptes** de jeu, jamais ceux d'autres joueurs.
- Pas de flood au-delà de ce qui est nécessaire pour démontrer un défaut de quota.
- Aucune tentative d'accès au compte Google qui héberge le Sheet.

## Mesures en place

- Toute la logique de jeu est côté serveur (Apps Script), et le client ne reçoit qu'une vue publique.
- Aléa cryptographique ; jetons de 244 bits stockés hachés (SHA-256).
- Verrou global, quotas, validation stricte des entrées, neutralisation des formules.
- CSP stricte + Trusted Types, aucune dépendance tierce dans le front.
- Scope Google minimal (`spreadsheets.currentonly`), Sheet non partagé.
- CI : 37 tests dont des tests d'attaque, CodeQL (`security-extended`), Dependabot, actions épinglées par SHA, test-garde contre les secrets commités.
