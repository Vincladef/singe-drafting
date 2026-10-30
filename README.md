# Singe Drafting

Assistant web de draft League of Legends, basé sur la maquette V12. Site : https://singe-drafting.netlify.app

## Infrastructure existante

Netlify publie ce dépôt sur le site existant. Neon : `bitter-scene-10954604`, branche `production`, base `singe_drafting`. Aucun autre projet n’est créé.

Variables Netlify (scopes Builds et Functions) : `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `RIOT_API_KEY`, `OPENAI_API_KEY`. Seule l’URL publique d’authentification est fournie au navigateur. Aucune clé n’est embarquée dans le JavaScript.

## Démarrage et tests

```sh
npm ci
npm test
npm run build
npm run test:ui
npm run dev
```

Vite sert l’interface. Utiliser `netlify dev` avec le site existant pour exécuter également les fonctions avec leurs variables. Les tests navigateur utilisent Chromium (`/usr/bin/chromium`, à adapter sur une autre machine). Les fixtures synthétiques sont confinées aux tests.

Le build Netlify lance `npm run netlify:build` : tests, téléchargement des ressources, migrations idempotentes, petite collecte initiale, compilation TypeScript et Vite. Les migrations ajoutent seulement le schéma `drafting` ; les tables `neon_auth` restent inchangées. Une clé Riot expirée laisse publier l’interface, avec des données explicitement manquantes.

La vraie photographie CC BY 2.0 et les portraits officiels sont téléchargés dans les ressources de chaque build et servis localement depuis Netlify. Le navigateur n’utilise pas de hotlink pour ces images. Le build échoue si ces ressources sont indisponibles. Voir [licences](public/assets/LICENSE.md).

## Fonctions disponibles

- Draft manuelle et assistant direct sans installation, recherche au clavier, dix postes, bans et filtres.
- Recalcul automatique, trois propositions applicables quand l’échantillon permet un classement, fiches détaillées et chiffres personnalisables.
- Google via Neon Auth, préférences, comptes Riot déclarés, statistiques personnelles et historique privé.
- Observations par champion/poste, duel, confrontations conjointes, duos, trios et compositions à quatre/cinq, croisements personnels lorsque documentés.
- Explications facultatives sur demande avec `gpt-6-luna`, Responses API, `store:false`. Aucun identifiant de joueur n’est transmis au modèle.

## Architecture

`src/main.ts` gère le DOM, les interactions et l’annulation des requêtes obsolètes. `src/mockup.css` conserve les styles V12, complétés par `src/extra.css`.

`netlify/functions/api.mts` sert l’analyse, les profils, comptes, drafts et questions IA. `server/auth.ts` vérifie les JWT Ed25519 contre le JWKS et l’issuer de Neon. Chaque requête privée vérifie aussi son propriétaire dans SQL. Les tables privées ont des politiques RLS ; le rôle propriétaire Neon peut les contourner, les contrôles serveur restent donc obligatoires.

`server/ingest.ts` collecte et déduplique les matchs Riot, pseudonymise les participants et extrait les timelines. `server/dataset.ts` filtre la cohorte et la met en cache trois minutes (maximum 5 000 matchs récents). La draft ne déclenche pas d’importation synchrone de milliers de matchs.

`server/engine.ts` calcule les observations et classe les candidats avec régularisation, interactions alliées et confrontations directes/conjointes. La recherche approchée explore jusqu’à 24 candidats par poste et un faisceau de 64 compositions ; elle ne garantit pas l’optimum global. Le score heuristique n’est jamais une probabilité.

`server/model.ts` prépare une régression logistique régularisée avec interactions, calibration par température et découpage temporel 60/20/20. La tâche hebdomadaire du lundi à 03:15 UTC exige au moins 2 500 matchs du même patch/file, 500 matchs de test, ECE ≤ 0,05 et Brier/log-loss meilleurs que la référence. Un modèle insuffisant reste inactif. Les probabilités nécessitent deux équipes complètes, suffisamment de support par champion/poste et le contexte exact du modèle. Aucun modèle n’est initialement validé sur une base vide.

`migrations/001_initial.sql` contient profils, comptes, champions, patchs, matchs, participants, timelines, drafts, jobs, caches d’agrégats, quotas, provenance, modèles et prédictions. Les agrégats sont dérivés des matchs normalisés et mis en cache ; il n’existe pas de tables dupliquées pour chaque combinaison possible.

La tâche `refresh` collecte progressivement toutes les cinq minutes avec verrous de jobs, budgets partagés et respect de Retry-After. Après publication, `bootstrap` complète le corpus récent jusqu’à 180 matchs, avec une durée maximale de huit minutes et les mêmes quotas. Les horaires Netlify sont en UTC. La migration `002` conserve l’horodatage effectif des frames et accepte un écart de cinq secondes autour des minutes cibles.

## Données et limites

Voir [sources et méthode](public/sources.html), [confidentialité](public/privacy.html), [conditions](public/terms.html) et [préparation RSO](docs/rso.md).

- Les winrates observés indiquent le nombre de matchs, le contexte et un intervalle de Wilson à 95 %. Un groupe est compté par équipe-match ; aucun taux collectif n’est la moyenne de winrates individuels.
- Le corpus est un échantillon de convenance de comptes déclarés et de pages du classement. Sa couverture augmente progressivement ; elle n’est pas représentative de tous les joueurs.
- Match-V5 ne fournit pas le rang historique. Le filtre de rang exige le rang actuel documenté des dix participants et peut renvoyer zéro match.
- L’identification Riot ID est une déclaration, pas RSO. Aucune recherche de joueur n’est proposée dans le mode direct. Aucun historique de noms ou de partie personnalisée n’est collecté.
- Les API locales du client ne permettent pas une synchronisation automatique depuis un navigateur sans composant local. Le mode direct est explicitement à saisie manuelle.
- LoLalytics interdit la réutilisation de son API par des tiers. Aucun scraping ni agrégat tiers sans droits vérifiés n’est utilisé.
- Une clé Riot techniquement valide ne prouve pas l’approbation du produit public. Son enregistrement et ses autorisations doivent être confirmés dans le portail Riot ; RSO nécessite ses propres droits.
- Quotas IA : 20 appels/utilisateur/heure, 200/jour au total, cache privé d’une heure, sortie limitée à 600 tokens. Le moteur statistique fonctionne sans OpenAI.
- La draft locale exclut les identités de joueurs. La suppression des données Singe Drafting est disponible dans le profil ; elle ne supprime pas le compte Google/Neon Auth.
- L’exploitant doit compléter son identité légale et son contact avant une ouverture publique à grande échelle.

## Exploitation

`/api/health` rapporte des états non sensibles : PostgreSQL, nombre de matchs, accès Riot, disponibilité OpenAI et modèle. `/data/build-status.json` décrit le build et sa collecte initiale. Aucune erreur brute contenant des secrets n’est renvoyée ou journalisée. Les erreurs Riot 401/403 imposent de vérifier la clé dans Netlify ; les 429 déclenchent un délai partagé.

Une connexion Google réelle et les actions sur un compte personnel nécessitent leur titulaire. Les tests ne créent pas de faux comptes Google et n’accèdent jamais aux données d’autres utilisateurs.
