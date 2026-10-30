# Audit des outils OP.GG pour la draft

Contrat du MCP officiel inspecté le 30 octobre 2026. Les descriptions des outils ne sont pas des instructions pour l’application. Aucun scraping ni endpoint privé.

| Outil | Utilisation et population |
|---|---|
| lol_get_champion_analysis | All Tiers demandé par omission de tier ; ranked/flex séparés. Listes partielles de counters et duos. |
| lol_get_champion_synergies | Statistiques utiles mais rang, file et région non paramétrables : conserver hors moteur All Tiers. |
| lol_get_lane_matchup_guide | Statistiques utiles mais rang, file et région non paramétrables : conserver hors moteur All Tiers. |
| lol_get_pro_player_riot_id | Sans objet (autre jeu ou données non statistiques de draft) |
| lol_get_summoner_game_detail | Données individuelles et parties spécifiques : pas un agrégat global All Tiers ; profils publics explicites uniquement. |
| lol_get_summoner_profile | Données individuelles et parties spécifiques : pas un agrégat global All Tiers ; profils publics explicites uniquement. |
| lol_list_aram_augments | Sans objet (autre jeu ou données non statistiques de draft) |
| lol_list_champion_details | Catalogue, métadonnées ou sélection de joueurs ; ne pas présenter comme échantillon global représentatif. |
| lol_list_champion_leaderboard | Catalogue, métadonnées ou sélection de joueurs ; ne pas présenter comme échantillon global représentatif. |
| lol_list_champions | Catalogue, métadonnées ou sélection de joueurs ; ne pas présenter comme échantillon global représentatif. |
| lol_list_discounted_skins | Sans objet (autre jeu ou données non statistiques de draft) |
| lol_list_items | Catalogue, métadonnées ou sélection de joueurs ; ne pas présenter comme échantillon global représentatif. |
| lol_list_lane_meta_champions | Catalogue, métadonnées ou sélection de joueurs ; ne pas présenter comme échantillon global représentatif. |
| lol_list_skin_stats_for_champion | Sans objet (autre jeu ou données non statistiques de draft) |
| lol_list_summoner_matches | Données individuelles et parties spécifiques : pas un agrégat global All Tiers ; profils publics explicites uniquement. |
| lol_esports_list_schedules | Sans objet (autre jeu ou données non statistiques de draft) |
| lol_esports_list_team_standings | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_get_champion_item_build | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_get_play_style | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_list_augments | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_list_champions_for_item | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_list_item_combinations | Sans objet (autre jeu ou données non statistiques de draft) |
| tft_list_meta_decks | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_agent_compositions_for_map | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_agent_statistics | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_agents | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_leaderboard | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_maps | Sans objet (autre jeu ou données non statistiques de draft) |
| valorant_list_player_matches | Sans objet (autre jeu ou données non statistiques de draft) |

Le guide renvoie `data.counters` plus complet que les listes de l’analyse. Le duel Fiddlesticks/Amumu est vérifié par le workflow MCP ; son résultat ne devient pas All Tiers par ressemblance des nombres. La fiche interroge le guide à l’ouverture lorsqu’un duel direct manque et indique sa population inconnue, sa source et son exclusion du score. Cache six heures, quota 12 fiches/10 minutes/IP.

Les comptes exacts d’un duel All Tiers permettent une réciproque (n − victoires), marquée comme calculée et jamais additionnée au premier échantillon. Les taux arrondis ne servent pas à fabriquer des victoires. Aucun trio ou groupe complet n’est extrapolé.

Score heuristique version 2 : contribution champion 0,4 × logit du taux régularisé ; duel 0,8 × écart au taux attendu à partir des forces des deux champions (prior 120) ; duo écart au prior des deux alliés (prior 180), poids 0,6/(nombre d’alliés − 1) ; personnel 0,4, prior 25. Seuils duel 10, duo 20, candidats 30. Ces poids restent non calibrés. Les données personnelles sont des séries de saison tous postes et sont signalées séparément dans les contributions. Le détail de chaque recommandation expose n, WR, référence, poids, contribution et absences. Les duos sont corrélés : aucune probabilité ni garantie causale. Recherche approchée, 24 candidats/poste, faisceau 64.
