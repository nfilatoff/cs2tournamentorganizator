using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Utils;
using Newtonsoft.Json.Linq;


namespace ArenaPro
{

    public partial class ArenaPro
    {
        public MatchConfig matchConfig = new();

        public bool isMatchSetup = false;

        public bool matchModeOnly = false;

        public bool resetCvarsOnSeriesEnd = true;

        public string loadedConfigFile = "";

        public Team arenaproTeam1 = new() {
            teamName = "COUNTER-TERRORISTS"
        };
        public Team arenaproTeam2 = new() {
            teamName = "TERRORISTS"
        };

        public Dictionary<Team, string> teamSides = new();
        public Dictionary<string, Team> reverseTeamSides = new();

        [ConsoleCommand("css_team1", "Sets team name for team1")]
        public void OnTeam1Command(CCSPlayerController? player, CommandInfo command) {
            HandleTeamNameChangeCommand(player, command.ArgString, 1);
        }

        [ConsoleCommand("css_team2", "Sets team name for team2")]
        public void OnTeam2Command(CCSPlayerController? player, CommandInfo command) {
            HandleTeamNameChangeCommand(player, command.ArgString, 2);
        }

        [ConsoleCommand("arenapro_loadmatch", "Loads a match from the given JSON file path (relative to the csgo/ directory)")]
        public void LoadMatch(CCSPlayerController? player, CommandInfo command)
        {
            try
            {
                if (player != null) return;
                if (isMatchSetup)
                {
                    // command.ReplyToCommand($"[LoadMatch] A match is already setup with id: {liveMatchId}, cannot load a new match!");
                    ReplyToUserCommand(player, Localizer["arenapro.mm.matchisalreadysetup", liveMatchId]);
                    Log($"[LoadMatch] A match is already setup with id: {liveMatchId}, cannot load a new match!");
                    return;
                }
                string fileName = command.ArgString;
                string filePath = Path.Join(Server.GameDirectory + "/csgo", fileName);
                if (!File.Exists(filePath)) 
                {
                    // command.ReplyToCommand($"[LoadMatch] Provided file does not exist! Usage: arenapro_loadmatch <filename>");
                    ReplyToUserCommand(player, Localizer["arenapro.mm.filedoesntexist"]);
                    Log($"[LoadMatch] Provided file does not exist! Usage: arenapro_loadmatch <filename>");
                    return;
                }
                string jsonData = File.ReadAllText(filePath);
                bool success = LoadMatchFromJSON(jsonData);
                if (!success)
                {
                    // command.ReplyToCommand("Match load failed! Resetting current match");
                    ReplyToUserCommand(player, Localizer["arenapro.mm.matchloadfailed"]);
                    ResetMatch();
                }
                loadedConfigFile = fileName;
            }
            catch (Exception e)
            {
                Log($"[LoadMatch - FATAL] An error occured: {e.Message}");
                return;
            }
        }

        [ConsoleCommand("get5_loadmatch_url", "Loads a match from the given URL")]
        [ConsoleCommand("arenapro_loadmatch_url", "Loads a match from the given URL")]
        public void LoadMatchFromURL(CCSPlayerController? player, CommandInfo command)
        {
            if (player != null) return;
            if (isMatchSetup)
            {
                // command.ReplyToCommand($"[LoadMatchDataCommand] A match is already setup with id: {liveMatchId}, cannot load a new match!");
                ReplyToUserCommand(player, Localizer["arenapro.mm.get5matchisalreadysetup", liveMatchId]);
                Log($"[LoadMatchDataCommand] A match is already setup with id: {liveMatchId}, cannot load a new match!");
                return;
            }
            string url = command.ArgByIndex(1);

            string headerName = command.ArgCount > 3 ? command.ArgByIndex(2) : "";
            string headerValue = command.ArgCount > 3 ? command.ArgByIndex(3) : "";

            Log($"[LoadMatchDataCommand] Match setup request received with URL: {ArenaProSecurity.RedactUrl(url)} headerName: {headerName} and headerValue: {ArenaProSecurity.RedactSecret(headerValue)}");

            if (!IsValidUrl(url))
            {
                // command.ReplyToCommand($"[LoadMatchDataCommand] Invalid URL: {url}. Please provide a valid URL to load the match!");
                ReplyToUserCommand(player, Localizer["arenapro.mm.invalidurl", ArenaProSecurity.RedactUrl(url)]);
                Log($"[LoadMatchDataCommand] Invalid URL: {ArenaProSecurity.RedactUrl(url)}. Please provide a valid URL to load the match!");
                return;
            }
            try
            {
                HttpClient httpClient = new();
                if (headerName != "")
                {
                    httpClient.DefaultRequestHeaders.Add(headerName, headerValue);
                }
                HttpResponseMessage response = httpClient.GetAsync(url).Result;

                if (response.IsSuccessStatusCode)
                {
                    string jsonData = response.Content.ReadAsStringAsync().Result;
                    Log($"[LoadMatchFromURL] Received match config ({jsonData.Length} characters)");

                    bool success = LoadMatchFromJSON(jsonData);
                    if (!success)
                    {
                        // command.ReplyToCommand("Match load failed! Resetting current match");
                        ReplyToUserCommand(player, Localizer["arenapro.mm.matchloadfailed"]);
                        ResetMatch();
                    }
                    loadedConfigFile = url;
                }
                else
                {
                    // command.ReplyToCommand($"[LoadMatchFromURL] HTTP request failed with status code: {response.StatusCode}");
                    ReplyToUserCommand(player, Localizer["arenapro.mm.httprequestfailed", response.StatusCode]);
                    Log($"[LoadMatchFromURL] HTTP request failed with status code: {response.StatusCode}");
                }
            }
            catch (Exception e)
            {
                Log($"[LoadMatchFromURL - FATAL] An error occured: {e.Message}");
                return;
            }
        }

        static string ValidateMatchJsonStructure(JObject jsonData)
        {
            string[] requiredFields = { "maplist", "team1", "team2", "num_maps" };

            // Check if any required field is missing
            foreach (string field in requiredFields)
            {
                if (jsonData[field] == null)
                {
                    return $"Missing mandatory field: {field}";
                }
            }

            foreach (var property in jsonData.Properties())
            {
                string field = property.Name;

                switch (field)
                {
                    case "matchid":
                        // The MySQL tables store matchid as INT.
                        if (!long.TryParse(jsonData[field]!.ToString(), out long matchIdValue) || matchIdValue < 0 || matchIdValue > int.MaxValue)
                        {
                            return $"{field} should be an integer between 0 and {int.MaxValue}!";
                        }
                        break;

                    case "players_per_team":
                    case "min_players_to_ready":
                    case "min_spectators_to_ready":
                    case "num_maps":
                        int numMaps;
                        if (!int.TryParse(jsonData[field]!.ToString(), out numMaps))
                        {
                            return $"{field} should be an integer!";

                        }
                        if (field == "num_maps" && numMaps < 1)
                        {
                            return $"{field} should be at least 1!";
                        }
                        if (field == "num_maps" && numMaps > jsonData["maplist"]!.ToObject<List<string>>()!.Count)
                        {
                            return $"{field} should be equal to or greater than maplist!";
                        }
                        
                        break;
                    
                    case "cvars":
                        if (jsonData[field]!.Type != JTokenType.Object)
                        {
                            return $"{field} should be a JSON structure!";
                        }
                        break;

                    case "team1":
                    case "team2":
                    case "spectators":
                        if (jsonData[field]!.Type != JTokenType.Object)
                        {
                            return $"{field} should be a JSON structure!";
                        }
                        if ((field != "spectators") && !MatchConfigJson.IsValidRoster(jsonData[field]!["players"]))
                        {
                            return $"{field} should have 'players' as an object of SteamID64s and names, or an array of SteamID64s!";
                        }
                        if (field == "spectators" && jsonData[field]!["players"] != null && !MatchConfigJson.IsValidRoster(jsonData[field]!["players"]))
                        {
                            return $"{field} 'players' should be an object of SteamID64s and names, or an array of SteamID64s!";
                        }
                        if ((field != "spectators") && string.IsNullOrWhiteSpace(jsonData[field]!["name"]?.ToString()))
                        {
                            return $"{field} should have a 'name'!";
                        }
                        break;

                    case "veto_mode":
                        if (jsonData[field]!.Type != JTokenType.Array)
                        {
                            return $"{field} should be an Array!";
                        }
                        break;

                    case "maplist":
                        if (jsonData[field]!.Type != JTokenType.Array)
                        {
                            return $"{field} should be an Array!";
                        }
                        if (!jsonData[field]!.Any())
                        {
                            return $"{field} should contain atleast 1 map!";
                        }

                        break;
                    case "map_sides":
                        if (jsonData[field]!.Type != JTokenType.Array)
                        {
                            return $"{field} should be an Array!";
                        }
                        string[] allowedValues = { "team1_ct", "team1_t", "team2_ct", "team2_t", "knife" };
                        bool allElementsValid = jsonData[field]!.All(element => allowedValues.Contains(element.ToString()));

                        if (!allElementsValid) {
                            return $"{field} should be \"team1_ct\", \"team1_t\", or \"knife\"!";
                        }
                        
                        if (jsonData[field]!.ToObject<List<string>>()!.Count < jsonData["num_maps"]!.Value<int>()) {
                            return $"{field} should be equal to or greater than num_maps!";
                        }
                        break;

                    case "skip_veto":
                    case "clinch_series":
                    case "wingman":
                        if (!MatchConfigJson.TryParseBool(jsonData[field], out _))
                        {
                            return $"{field} should be a boolean!";
                        }
                        break;

                    case "side_type":
                        if (!MatchConfigJson.SideTypes.Contains(jsonData[field]!.ToString().Trim().ToLowerInvariant()))
                        {
                            return $"{field} should be one of: {string.Join(", ", MatchConfigJson.SideTypes)}!";
                        }
                        break;

                    case "veto_first":
                        if (!MatchConfigJson.VetoFirstValues.Contains(jsonData[field]!.ToString().Trim().ToLowerInvariant()))
                        {
                            return $"{field} should be one of: {string.Join(", ", MatchConfigJson.VetoFirstValues)}!";
                        }
                        break;
                }
            }

            return "";
        }

        public bool LoadMatchFromJSON(string jsonData)
        {
            
            JObject jsonDataObject = JObject.Parse(jsonData);

            string validationError = ValidateMatchJsonStructure(jsonDataObject);
            bool mapChangesOnLoad = false;

            if (validationError != "")
            {
                Log($"[LoadMatchDataCommand] {validationError}");
                return false;
            }

            if(jsonDataObject["matchid"] != null)
            {
                liveMatchId = (long)jsonDataObject["matchid"]!;
            }
            JToken team1 = jsonDataObject["team1"]!;
            JToken team2 = jsonDataObject["team2"]!;
            JToken maplist = jsonDataObject["maplist"]!;

            if (team1["id"] != null) arenaproTeam1.id = team1["id"]!.ToString();
            if (team2["id"] != null) arenaproTeam2.id = team2["id"]!.ToString();

            arenaproTeam1.teamName = RemoveSpecialCharacters(team1["name"]!.ToString());
            arenaproTeam2.teamName = RemoveSpecialCharacters(team2["name"]!.ToString());
            arenaproTeam1.teamPlayers = MatchConfigJson.NormalizeRoster(team1["players"]);
            arenaproTeam2.teamPlayers = MatchConfigJson.NormalizeRoster(team2["players"]);
            // Who readies the team in captain mode (arenapro_ready_mode 2); optional.
            arenaproTeam1.captainSteamId = team1["captain"]?.ToString() ?? "";
            arenaproTeam2.captainSteamId = team2["captain"]?.ToString() ?? "";

            // The previous match's veto must not decide who starts or picks sides in this one.
            lastVetoTeam = CsTeam.None;
            readyTimeWaitingUsed = 0;

            // As in Get5: nobody is ready in a newly loaded match (players may have typed .ready before it was loaded, and they
            // only reconnect, which resets it, when the map changes), and the game is not left paused.
            ResetReadyStatus();
            UnpauseIfPaused();

            matchConfig = new()
            {
                MatchId = liveMatchId,
                MapsPool = maplist.ToObject<List<string>>()!,
                MapsLeftInVetoPool = maplist.ToObject<List<string>>()!,
                NumMaps = jsonDataObject["num_maps"]!.Value<int>(),
                MinPlayersToReady = minimumReadyRequired,
                // Like Get5, a map pool larger than num_maps is vetoed unless "skip_veto": true is set.
                SkipVeto = false,
            };
            // Start from the server's remote log settings (config.cfg); the match config's cvars can override them for this match.
            ApplyDefaultRemoteLogSettings();

            GetOptionalMatchValues(jsonDataObject);

            if (matchConfig.MapsPool.Count == matchConfig.NumMaps)
            {
                matchConfig.SkipVeto = true;
                isPreVeto = false;
            }
            else if (matchConfig.MapsPool.Count < matchConfig.NumMaps)
            {
                Log($"[LOADMATCH] The map pool {matchConfig.MapsPool.Count} is not large enough to play a series of {matchConfig.NumMaps} maps.");
                return false;
            }

            if (!matchConfig.SkipVeto)
            {
                if (matchConfig.MapBanOrder.Count != 0)
                {
                    if (!ValidateMapBanLogic()) return false;
                    if (matchConfig.VetoFirst == "team2")
                    {
                        Log("[LOADMATCH] veto_first only applies to the default veto order; veto_mode is used exactly as written.");
                    }
                }
                else
                {
                    GenerateDefaultVetoSetup();
                }
            }

            GetCvarValues(jsonDataObject);

            Log($"[LOADMATCH] MinPlayersToReady: {matchConfig.MinPlayersToReady} SeriesClinch: {matchConfig.SeriesCanClinch}");
            Log($"[LOADMATCH] MapsPool: {string.Join(", ", matchConfig.MapsPool)} MapsLeftInVetoPool: {string.Join(", ", matchConfig.MapsLeftInVetoPool)}");

            LoadClientNames();

            if (matchConfig.SkipVeto)
            {
                // Copy the first k maps from the maplist to the final match maps.
                for (int i = 0; i < matchConfig.NumMaps; i++) 
                {
                    matchConfig.Maplist.Add(matchConfig.MapsPool[i]);

                    // Push a map side if one hasn't been set yet.
                    if (matchConfig.MapSides.Count < matchConfig.Maplist.Count) {
                        if (matchConfig.MatchSideType == "standard" || matchConfig.MatchSideType == "always_knife") {
                            matchConfig.MapSides.Add("knife");
                        } else if (matchConfig.MatchSideType == "random") {
                            matchConfig.MapSides.Add(new Random().Next(0, 2) == 0 ? "team1_ct" : "team1_t");
                        } else {
                            matchConfig.MapSides.Add("team1_ct");
                        }
                    }
                }
                string currentMapName = Server.MapName;
                string mapName = matchConfig.Maplist[0].ToString();

                if (IsMapReloadRequiredForGameMode(matchConfig.Wingman) || mapReloadRequired || currentMapName != mapName) 
                {
                    SetCorrectGameMode();
                    ChangeMap(mapName, 0);
                    mapChangesOnLoad = true;
                }
            }
            else
            {
                isPreVeto = true;
            } 

            readyAvailable = true;

            // This is done before starting warmup so that cvars like get5_remote_log_url are set properly to send the events
            ExecuteChangedConvars();

            StartWarmup();

            isMatchSetup = true;

            if(matchConfig.SkipVeto) SetMapSides();

            SetTeamNames();
            UpdatePlayersMap();
            UpdateHostname();
            // A map change assigns teams on full connect. On the current map, also assign players already here.
            if (!mapChangesOnLoad) PlacePlayersOnMatchTeams();

            var seriesStartedEvent = new ArenaProSeriesStartedEvent
            {
                MatchId = liveMatchId,
                NumberOfMaps = matchConfig.NumMaps,
                Team1 = new(arenaproTeam1.id, arenaproTeam1.teamName),
                Team2 = new(arenaproTeam2.id, arenaproTeam2.teamName),
            };

            Task.Run(async () => {
                await SendEventAsync(seriesStartedEvent);
            });

            Log($"[LoadMatchFromJSON] Success with matchid: {liveMatchId}!");
            return true;
        }

        private void ResetReadyStatus()
        {
            foreach (var key in playerReadyStatus.Keys.ToList())
            {
                playerReadyStatus[key] = false;
            }
            teamReadyOverride = new()
            {
                {CsTeam.Terrorist, false},
                {CsTeam.CounterTerrorist, false},
                {CsTeam.Spectator, false}
            };
            captainReady["team1"] = captainReady["team2"] = false;
        }

        private void UnpauseIfPaused()
        {
            if (isPaused)
            {
                UnpauseMatch();
                return;
            }
            try
            {
                // Paused outside ArenaPro (e.g. mp_pause_match from the console).
                if (GetGameRules().GamePaused) Server.ExecuteCommand("mp_unpause_match;");
            }
            catch (Exception e)
            {
                Log($"[UnpauseIfPaused] {e.Message}");
            }
        }

        // Includes players still on the initial team selection screen.
        private void PlacePlayersOnMatchTeams()
        {
            foreach (var player in playerData.Values)
            {
                if (!player.IsValid || player.IsBot || player.IsHLTV || player.Connected != PlayerConnectedState.Connected) continue;
                SwitchPlayerTeam(player, GetPlayerTeam(player));
            }
        }

        public void SetMapSides() {
            int mapNumber = matchConfig.CurrentMapNumber;
            if (matchConfig.MapSides[mapNumber] == "team1_ct" || matchConfig.MapSides[mapNumber] == "team2_t")
            {
                teamSides[arenaproTeam1] = "CT";
                teamSides[arenaproTeam2] = "TERRORIST";
                reverseTeamSides["CT"] = arenaproTeam1;
                reverseTeamSides["TERRORIST"] = arenaproTeam2;
                isKnifeRequired = false;
            }
            else if (matchConfig.MapSides[mapNumber] == "team2_ct" || matchConfig.MapSides[mapNumber] == "team1_t")
            {
                teamSides[arenaproTeam2] = "CT";
                teamSides[arenaproTeam1] = "TERRORIST";
                reverseTeamSides["CT"] = arenaproTeam2;
                reverseTeamSides["TERRORIST"] = arenaproTeam1;
                isKnifeRequired = false;
            }
            else if (matchConfig.MapSides[mapNumber] == "knife")
            {
                // Start the knife round from a known state instead of the sides left over from the previous map or match.
                teamSides[arenaproTeam1] = "CT";
                teamSides[arenaproTeam2] = "TERRORIST";
                reverseTeamSides["CT"] = arenaproTeam1;
                reverseTeamSides["TERRORIST"] = arenaproTeam2;
                isKnifeRequired = true;
            }

            SetTeamNames();
        }

        public void SetTeamNames()
        {
            Server.ExecuteCommand($"mp_teamname_1 \"{reverseTeamSides["CT"].teamName}\"");
            Server.ExecuteCommand($"mp_teamname_2 \"{reverseTeamSides["TERRORIST"].teamName}\"");
        }

        public void GetCvarValues(JObject jsonDataObject)
        {
            try
            {
                if (jsonDataObject["cvars"] == null) return;

                foreach (JProperty cvarData in jsonDataObject["cvars"]!)
                {
                    string cvarName = cvarData.Name;
                    string cvarValue = cvarData.Value.ToString();

                    if (!IsAllowedMatchCvar(cvarName, cvarValue, out string reason))
                    {
                        Log($"[GetCvarValues] Ignoring cvar {cvarName} from the match config: {reason}");
                        continue;
                    }

                    matchConfig.ChangedCvars[cvarName] = cvarValue;
                    // Remember the value from before the match (convars, and also ArenaPro settings) to restore at series end.
                    if (!matchConfig.OriginalCvars.ContainsKey(cvarName))
                    {
                        string? originalValue = GetCurrentSettingValue(cvarName);
                        if (originalValue != null) matchConfig.OriginalCvars[cvarName] = originalValue;
                    }
                }

            }
            catch (Exception e)
            {
                Log($"[GetCvarValues FATAL] An error occurred: {e.Message}");
            }
        }

        public void GetOptionalMatchValues(JObject jsonDataObject)
        {
            if(jsonDataObject["map_sides"] != null)
            {
                matchConfig.MapSides = jsonDataObject["map_sides"]!.ToObject<List<string>>()!;
            }
            if(jsonDataObject["players_per_team"] != null)
            {
                matchConfig.PlayersPerTeam = jsonDataObject["players_per_team"]!.Value<int>();
            }
            if(jsonDataObject["min_players_to_ready"] != null)
            {
                matchConfig.MinPlayersToReady = jsonDataObject["min_players_to_ready"]!.Value<int>();
            }
            if(jsonDataObject["min_spectators_to_ready"] != null)
            {
                matchConfig.MinSpectatorsToReady = jsonDataObject["min_spectators_to_ready"]!.Value<int>();
            }
            if (jsonDataObject["spectators"] != null && jsonDataObject["spectators"]!["players"] != null)
            {
                matchConfig.Spectators = MatchConfigJson.NormalizeRoster(jsonDataObject["spectators"]!["players"]);
            }
            if (MatchConfigJson.TryParseBool(jsonDataObject["clinch_series"], out bool clinchSeries))
            {
                matchConfig.SeriesCanClinch = clinchSeries;
            }
            if (MatchConfigJson.TryParseBool(jsonDataObject["skip_veto"], out bool skipVeto))
            {
                matchConfig.SkipVeto = skipVeto;
            }
            if (MatchConfigJson.TryParseBool(jsonDataObject["wingman"], out bool wingman))
            {
                matchConfig.Wingman = wingman;
            }
            if (jsonDataObject["side_type"] != null)
            {
                matchConfig.MatchSideType = jsonDataObject["side_type"]!.ToString().Trim().ToLowerInvariant();
            }
            matchConfig.VetoFirst = MatchConfigJson.ResolveVetoFirst(jsonDataObject["veto_first"]?.ToString(), new Random());
            if (jsonDataObject["veto_mode"] != null)
            {
                matchConfig.MapBanOrder = jsonDataObject["veto_mode"]!.ToObject<List<string>>()!;
            }
            
        }

        public void HandleTeamNameChangeCommand(CCSPlayerController? player, string teamName, int teamNum) {
            if (!IsPlayerAdmin(player, "css_team", "@css/config")) {
                SendPlayerNotAdminMessage(player);
                return;
            }
            if (matchStarted) {
                // ReplyToUserCommand(player, "Team names cannot be changed once the match is started!");
                ReplyToUserCommand(player, Localizer["arenapro.mm.teamcannotbechanged"]);
                return;
            }
            teamName = RemoveSpecialCharacters(teamName.Trim());
            if (teamName == "") {
                // ReplyToUserCommand(player, $"Usage: !team{teamNum} <name>");
                ReplyToUserCommand(player, Localizer["arenapro.cc.usage", $"!team{teamNum} <name>"]);
                return;
            }

            if (teamNum == 1) {
                arenaproTeam1.teamName = teamName;
                teamSides[arenaproTeam1] = "CT";
                reverseTeamSides["CT"] = arenaproTeam1;
                foreach (var coach in arenaproTeam1.coach)
                {
                    coach.Clan = $"[{arenaproTeam1.teamName} COACH]";
                }
            } else if (teamNum == 2) {
                arenaproTeam2.teamName = teamName;
                teamSides[arenaproTeam2] = "TERRORIST";
                reverseTeamSides["TERRORIST"] = arenaproTeam2;
                foreach (var coach in arenaproTeam2.coach)
                {
                    coach.Clan = $"[{arenaproTeam2.teamName} COACH]";
                }
            }
            Server.ExecuteCommand($"mp_teamname_{teamNum} \"{teamName}\";");
        }

        public void SwapSidesInTeamData(bool swapTeams) {
            // if (swapTeams) {
            //     // Here, we sync arenaproTeam1 and arenaproTeam2 with the actual team1 and team2
            //     (arenaproTeam2, arenaproTeam1) = (arenaproTeam1, arenaproTeam2);
            // }

            (teamSides[arenaproTeam1], teamSides[arenaproTeam2]) = (teamSides[arenaproTeam2], teamSides[arenaproTeam1]);
            (reverseTeamSides["CT"], reverseTeamSides["TERRORIST"]) = (reverseTeamSides["TERRORIST"], reverseTeamSides["CT"]);
        }

        private CsTeam GetPlayerTeam(CCSPlayerController player)
        {
            CsTeam playerTeam = CsTeam.None;
            var steamId = player.SteamID;
            try
            {
                if (arenaproTeam1.teamPlayers != null && arenaproTeam1.teamPlayers[steamId.ToString()] != null)
                {
                    if (teamSides[arenaproTeam1] == "CT")
                    {
                        playerTeam = CsTeam.CounterTerrorist;
                    }
                    else if (teamSides[arenaproTeam1] == "TERRORIST")
                    {
                        playerTeam = CsTeam.Terrorist;
                    }

                }
                else if (arenaproTeam2.teamPlayers != null && arenaproTeam2.teamPlayers[steamId.ToString()] != null)
                {
                    if (teamSides[arenaproTeam2] == "CT")
                    {
                        playerTeam = CsTeam.CounterTerrorist;
                    }
                    else if (teamSides[arenaproTeam2] == "TERRORIST")
                    {
                        playerTeam = CsTeam.Terrorist;
                    }
                }
                else if (matchConfig.Spectators != null && matchConfig.Spectators[steamId.ToString()] != null)
                {
                    playerTeam = CsTeam.Spectator;
                }
            }
            catch (Exception ex)
            {
                Log($"[GetPlayerTeam - FATAL] Exception occurred: {ex.Message}");
            }
            return playerTeam;
        }

        // winner: null for a tie, or when cancelled (the series was ended by an admin without a winner; stored with an empty winner).
        // restartDelay <= 0 resets the match right away, so that a command run right after (e.g. loading the next match) is not undone.
        // Set by EndSeries until the match is reset: the series is over and must not be ended (or cancelled) again.
        public bool seriesEnded = false;

        public void EndSeries(Team? winner, int restartDelay, int t1score, int t2score, bool cancelled = false, bool warmupCfgRequired = false)
        {
            seriesEnded = true;
            long matchId = liveMatchId;
            (int team1Score, int team2Score) = (arenaproTeam1.seriesScore, arenaproTeam2.seriesScore);
            string? winnerName = winner?.teamName;
            if (cancelled)
            {
                // The admin who ended the match was already announced.
            }
            else if (winner == null)
            {
                PrintToAllChat($"{ChatColors.Green}{arenaproTeam1.teamName}{ChatColors.Default} and {ChatColors.Green}{arenaproTeam2.teamName}{ChatColors.Default} have tied the match");
            }
            else
            {
                Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{winnerName}{ChatColors.Default} has won the match");
            }

            var seriesResultEvent = new ArenaProSeriesResultEvent()
            {
                MatchId = matchId,
                Winner = GetTeamWinner(winner),
                Team1SeriesScore = team1Score,
                Team2SeriesScore = team2Score,
                TimeUntilRestore = 10,
            };
            // Captured now: the match (and its remote log settings) may be reset before the event is sent.
            RemoteLogTarget target = CurrentRemoteLogTarget();

            database.SetMatchEndData(matchId, cancelled ? "" : winnerName ?? "Draw", team1Score, team2Score);
            Task.Run(async () => {
                // Making sure that map end event is fired first
                await Task.Delay(2000);
                await SendEventAsync(seriesResultEvent, target);
            });

            if (resetCvarsOnSeriesEnd) ResetChangedConvars();
            isMatchLive = false;
            if (restartDelay <= 0)
            {
                ResetMatch(warmupCfgRequired);
                return;
            }
            AddTimer(restartDelay, () => {
                ResetMatch(warmupCfgRequired);
            });
        }

        // get5_endmatch / .forceend: without a team the match is cancelled (no winner), with "team1" or "team2" that team wins
        // the current map (if one is live) and the series. Either way the series is closed like a normal series end
        // (map_result / series_end events, database end data, match config cvars restored) and the match is reset right away.
        public void ForceEndSeries(Team? forcedWinner)
        {
            // Between maps of a series (map over, next one not live yet) there is no map to end.
            bool mapInProgress = isMatchLive && !currentMapFinished;
            (int t1score, int t2score) = mapInProgress ? GetTeamsScore() : (0, 0);

            if (mapInProgress)
            {
                if (forcedWinner != null) forcedWinner.seriesScore++;
                PublishMapEnd(forcedWinner, forcedWinner?.teamName ?? "", t1score, t2score);
                // The demo is stopped now (the match is reset right away); it is still uploaded.
                if (isDemoRecording) StopDemoRecording(0, activeDemoFile, liveMatchId, matchConfig.CurrentMapNumber);
            }

            if (forcedWinner != null)
            {
                // A forfeit awards the series: the winner's series score is raised to the maps needed to win (e.g. 1-0 in a
                // BO1, 2-x in a BO3). Get5 keeps the score as it is, but panels that judge the result by the score (G5V
                // shows 0:0 as a tie) would then not show the win; G5API's own forfeit also writes a winning score.
                Team loser = forcedWinner == arenaproTeam1 ? arenaproTeam2 : arenaproTeam1;
                forcedWinner.seriesScore = SeriesLogic.ForfeitWinnerSeriesScore(matchConfig.NumMaps, forcedWinner.seriesScore, loser.seriesScore);
            }

            EndSeries(forcedWinner, 0, t1score, t2score, cancelled: forcedWinner == null, warmupCfgRequired: true);
        }

        public void HandlePlayoutConfig()
        {
            if (isPlayOutEnabled) {
                Server.ExecuteCommand("mp_overtime_enable 0");
                Server.ExecuteCommand("mp_match_can_clinch false");
            } else {
                var cfgPath = GetGameMode() == 1 ? liveCfgPath : liveWingmanCfgPath;
                var absoluteCfgPath = Path.Join(Server.GameDirectory + "/csgo/cfg", cfgPath);
                // The override CFG runs after the live CFG, so a value set there wins.
                var absoluteOverrideCfgPath = Path.Join(Server.GameDirectory + "/csgo/cfg", OverrideCfgPath(cfgPath));
                string? GetLiveCfgValue(string convarName) =>
                    (File.Exists(absoluteOverrideCfgPath) ? GetConvarValueFromCFGFile(absoluteOverrideCfgPath, convarName) : null)
                    ?? GetConvarValueFromCFGFile(absoluteCfgPath, convarName);
                string? matchCanClinch = GetLiveCfgValue("mp_match_can_clinch");
                string? overtimeEnabled = GetLiveCfgValue("mp_overtime_enable");
                Server.ExecuteCommand($"mp_match_can_clinch {matchCanClinch ?? "1"}");
                Server.ExecuteCommand($"mp_overtime_enable {overtimeEnabled ?? "1"}");
            }
        }

    }
}
