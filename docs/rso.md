# Riot Sign On — intégration inactive

Les comptes associés portent `identity_kind='declared'`. Le frontend ne peut pas les promouvoir en comptes autorisés RSO.

Prérequis : produit approuvé, clé Riot de production, client RSO accordé par Riot, redirect URI HTTPS enregistrée, scopes et secrets serveur. Un Riot ID valide ne prouve aucun de ces droits.

Après autorisation, ajouter `/api/rso/start` et `/api/rso/callback` : session Neon requise, state aléatoire à usage unique lié à la session et expirant rapidement, PKCE selon le contrat Riot accordé, échange du code côté serveur, validation issuer/audience/nonce, puis appel d’Account-V1 `/riot/account/v1/accounts/me`. Associer uniquement le PUUID renvoyé par cette autorisation. Garder les tokens chiffrés côté serveur, révocables, avec consentement et déconnexion explicites.

Sans ces prérequis, aucun faux callback ni bouton « Connecté à Riot » n’est publié. Le service utilise les identités déclarées et les données publiques autorisées.

Documentation : https://developer.riotgames.com/docs/lol#rso-integration
