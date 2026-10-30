# Singe Drafting

Application Vite / TypeScript, fonctions Netlify et PostgreSQL Neon existants. Production : https://singe-drafting.netlify.app

## Statistiques OP.GG

Le SDK MCP appelle uniquement `https://mcp-api.op.gg/mcp` côté serveur. `lol_list_champions` fournit le catalogue ; `lol_get_champion_analysis` fournit les agrégats avec `tier` omis (All Tiers), en ranked ou flex. Le lane meta détermine seulement le poste principal de chaque requête, pas les taux affichés. Aucun paramètre régional n’existe pour ces agrégats : **Global non vérifiable**, affiché explicitement dans le produit.

Les données sont normalisées dans deux instantanés JSONB compacts du cache Neon. Un rafraîchissement signé et verrouillé tourne toutes les six heures. Les lots interrompus reprennent sans stockage de matchs bruts. L’ancien corpus et ses modèles ne sont plus utilisés ; pas d’API Riot, pas de jobs Match-V5, pas de Timeline, pas de Spectator. RIOT_API_KEY peut être retirée des variables Netlify. Data Dragon reste uniquement le CDN public des portraits et noms français, sans clé.

Le profil personnel `lol_get_summoner_profile` utilise le Riot ID saisi sur le site, une identité exacte et un cache de 15 minutes. Les profils et drafts sont isolés par session Neon Auth et propriétaire SQL, avec RLS en défense supplémentaire. Migration additive `004_opgg.sql`, anciens comptes copiés sans PUUID. Pas de suppression du corpus historique ni des données utilisateur.

Les champs indisponibles restent null : région, total global de matchs uniques, timelines, trios, compositions complètes, probabilités calibrées, rencontres entre joueurs et partie en cours. Les duos présents dans les réponses de l’analyse alimentent le moteur. Les outils guide/synergie dédiés ne sont pas mélangés à All Tiers, leur population n’étant pas contractualisée par ce paramètre. Le score régularisé sert au classement, jamais à inventer un winrate.

La licence MIT du logiciel MCP ne couvre pas les droits de redistribution des statistiques. Les conditions et la nécessité de clarification pour la republication publique/commerciale sont documentées dans [sources](public/sources.html). Aucun scraping ou contournement de restrictions.

## Développement et déploiement

Node 24, `npm ci`, `npm test`, `npm run check`, `npm run test:ui` (Chromium local), `npm run build`. `npm run netlify:build` applique les migrations idempotentes, télécharge les ressources statiques licenciées, récupère OP.GG et vérifie le backend réel avant publication. Variables serveur : DATABASE_URL, NEON_AUTH_BASE_URL, OPENAI_API_KEY. Le MCP public ne requiert actuellement pas de clé ; les changements de contrat produisent une erreur propre et conservent le dernier instantané.

Push main déclenche Netlify existant et les contrôles Playwright de production (desktop/mobile). La suite couvre parseur MCP sans évaluation de code, compteurs/taux, valeurs manquantes, duos, recommandations 1–5 postes, sessions, limites du direct, saisie personnelle et application des recommandations. L’authentification Google est vérifiée jusqu’à la redirection du fournisseur ; aucun faux compte ni consentement n’est simulé.

Luna reste optionnel, via OpenAI côté serveur avec quotas, contexte structuré et cache. Il ne génère aucune statistique pour le moteur.
