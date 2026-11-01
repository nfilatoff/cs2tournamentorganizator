using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Admin;
using System.Text.RegularExpressions;
using System.Text;
using Newtonsoft.Json.Linq;
using System.Drawing;
using System.Reflection;
using System.Globalization;


namespace ArenaPro
{
    public partial class ArenaPro
    {
        public const string warmupCfgPath = "ArenaPro/warmup.cfg";
        public const string knifeCfgPath = "ArenaPro/knife.cfg";
        public const string liveCfgPath = "ArenaPro/live.cfg";
        public const string liveWingmanCfgPath = "ArenaPro/live_wingman.cfg";

        private void PrintToAllChat(string message)
        {
            Server.PrintToChatAll($"{chatPrefix} {message}");
        }

        private void PrintToPlayerChat(CCSPlayerController player, string message)
        {
            player.PrintToChat($"{chatPrefix} {message}");
        }

        private void ReplyToUserCommand(CCSPlayerController? player, string message, bool console = false)
        {
            if (player == null)
            {
                Server.PrintToConsole($"{chatPrefix} {message}");
            }
            else
            {
                if (console)
                {
                    player.PrintToConsole($"{chatPrefix} {message}");
                }
                else
                {
                    player.PrintToChat($"{chatPrefix} {message}");
                }
            }
        }

        private void LoadAdmins()
        {
            string fileName = "ArenaPro/admins.json";
            string filePath = Path.Join(Server.GameDirectory + "/csgo/cfg", fileName);

            if (File.Exists(filePath))
            {
                try
                {
                    using (StreamReader fileReader = File.OpenText(filePath))
                    {
                        string jsonContent = fileReader.ReadToEnd();
                        if (!string.IsNullOrEmpty(jsonContent))
                        {
                            JsonSerializerOptions options = new()
                            {
                                AllowTrailingCommas = true,
                            };
                            loadedAdmins = JsonSerializer.Deserialize<Dictionary<string, string>>(jsonContent, options) ?? new Dictionary<string, string>();
                        }
                        else
                        {
                            // Handle the case where the JSON content is empty or null
                            loadedAdmins = new Dictionary<string, string>();
                        }
                    }
                    foreach (var kvp in loadedAdmins)
                    {
                        Log($"[ADMIN] Username: {kvp.Key}, Role: {kvp.Value}");
                        if (!string.IsNullOrWhiteSpace(kvp.Value) && ArenaProSecurity.GetAdminFlags(kvp.Value).Count == 0 && kvp.Value.IndexOfAny(new[] { '@', '#', '/' }) >= 0)
                        {
                            Log($"[ADMIN WARNING] {kvp.Key}: \"{kvp.Value}\" contains no valid flag (expected e.g. @css/config), so this admin has full ArenaPro admin access.");
                        }
                    }
                }
                catch (Exception e)
                {
                    Log($"[LoadAdmins FATAL] An error occurred: {e.Message}");
                }
            }
            else
            {
                Log("[LoadAdmins] The JSON file does not exist. Creating one with default content");
                Dictionary<string, string> defaultAdmins = new()
                {
                    { "steamid", "" }
                };

                try
                {
                    JsonSerializerOptions options = new()
                    {
                        WriteIndented = true,
                    };
                    string defaultJson = JsonSerializer.Serialize(defaultAdmins, options);
                    string? directoryPath = Path.GetDirectoryName(filePath);
                    if (directoryPath != null)
                    {
                        if (!Directory.Exists(directoryPath))
                        {
                            Directory.CreateDirectory(directoryPath);
                        }
                    }
                    File.WriteAllText(filePath, defaultJson);

                    Log("[LoadAdmins] Created a new JSON file with default content.");
                }
                catch (Exception e)
                {
                    Log($"[LoadAdmins FATAL] Error creating the JSON file: {e.Message}");
                }
            }
        }

        // An admin's commands only work after the admin has typed the server's admin code (arenapro_admin_auth_code) in the
        // client console, so a known SteamID alone is not enough to control the server.
        private bool IsPlayerAdmin(CCSPlayerController? player, string command = "", params string[] permissions)
        {
            if (everyoneIsAdmin.Value) return true; // Everyone is treated as admin if arenapro_everyone_is_admin is true.
            if (!IsPlayerAdminIgnoringAuth(player, command, permissions)) return false;
            return player == null || adminAuth.IsAuthorized(player.SteamID);
        }

        private bool IsPlayerAdminIgnoringAuth(CCSPlayerController? player, string command = "", params string[] permissions)
        {
            string[] updatedPermissions = permissions.Concat(new[] { "@css/root" }).ToArray();
            RequiresPermissionsOr attr = new(updatedPermissions)
            {
                Command = command
            };
            if (attr.CanExecuteCommand(player)) return true; // Admin exists in admins.json of CSSharp
            if (player == null) return true; // Sent via server, hence should be treated as an admin.
            if (loadedAdmins.TryGetValue(player.SteamID.ToString(), out string? role)) // Admin exists in admins.json of ArenaPro
            {
                List<string> flags = ArenaProSecurity.GetAdminFlags(role);
                if (flags.Count == 0) return true; // No flags given (e.g. "" or a name): full ArenaPro admin, as before.
                return ArenaProSecurity.AdminFlagsGrant(flags, updatedPermissions);
            }
            return false;
        }

        private int GetRealPlayersCount()
        {
            return playerData.Count;
        }

        private void SendUnreadyPlayersMessage()
        {
            if (!isWarmup || matchStarted) return;
            if (IsJoinReadyMode())
            {
                // Join mode: nobody needs to type .ready; say how many players each team still needs (or that it is starting).
                if (joinStartSecondsLeft != null) return;
                int team1Side = GetTeamSideNumber("team1");
                int team2Side = GetTeamSideNumber("team2");
                bool team1Complete = ReadyTimeLogic.IsTeamComplete(GetJoinedPlayerCount(team1Side), GetTeamMinReady(team1Side));
                bool team2Complete = ReadyTimeLogic.IsTeamComplete(GetJoinedPlayerCount(team2Side), GetTeamMinReady(team2Side));
                if (IsCaptainReadyMode() && team1Complete && team2Complete)
                {
                    // Everyone is here: remind the captains who still have to type .ready.
                    foreach (var (key, team) in new[] { ("team1", arenaproTeam1), ("team2", arenaproTeam2) })
                    {
                        if (!captainReady[key]) PrintToAllChat(Localizer["arenapro.ready.captainmustready", team.teamName]);
                    }
                    return;
                }
                PrintToAllChat(Localizer["arenapro.ready.waitingforplayers",
                    arenaproTeam1.teamName, GetJoinedPlayerCount(team1Side), GetTeamMinReady(team1Side),
                    arenaproTeam2.teamName, GetJoinedPlayerCount(team2Side), GetTeamMinReady(team2Side)]);
                return;
            }
            List<string> unreadyPlayers = new();

            foreach (var key in playerReadyStatus.Keys)
            {
                if (playerReadyStatus[key] == false)
                {
                    unreadyPlayers.Add(playerData[key].PlayerName);
                }
            }
            if (unreadyPlayers.Count > 0)
            {
                string unreadyPlayerList = string.Join(", ", unreadyPlayers);
                string minimumReadyRequiredMessage = isMatchSetup ? "" : $"[Minimum ready players required: {ChatColors.Green}{minimumReadyRequired}{ChatColors.Default}]";

                // Server.PrintToChatAll($"{chatPrefix} Unready players: {unreadyPlayerList}. Please type .ready to ready up! {minimumReadyRequiredMessage}");
                if (isRoundRestorePending)
                {
                    PrintToAllChat(Localizer["arenapro.ready.readytotestorebackupinfomessage", unreadyPlayerList, minimumReadyRequiredMessage]);
                }
                else
                {
                    PrintToAllChat(Localizer["arenapro.utility.unreadyplayers", unreadyPlayerList, minimumReadyRequiredMessage]);
                }
            }
            else
            {
                int countOfReadyPlayers = playerReadyStatus.Count(kv => kv.Value == true);
                if (isMatchSetup)
                {
                    // Server.PrintToChatAll($"{chatPrefix} Current ready players: {ChatColors.Green}{countOfReadyPlayers}{ChatColors.Default}");
                    PrintToAllChat(Localizer["arenapro.utility.readyplayers", countOfReadyPlayers]);
                }
                else
                {
                    // Server.PrintToChatAll($"{chatPrefix} Minimum ready players required {ChatColors.Green}{minimumReadyRequired}{ChatColors.Default}, current ready players: {ChatColors.Green}{countOfReadyPlayers}{ChatColors.Default}");
                    PrintToAllChat(Localizer["arenapro.utility.minimumreadyplayers", minimumReadyRequired, countOfReadyPlayers]);
                }
            }
        }

        private void SendPausedStateMessage()
        {
            if (isPaused && matchStarted)
            {
                var pauseTeamName = unpauseData["pauseTeam"];
                if ((string)pauseTeamName == "Admin")
                {
                    PrintToAllChat(Localizer["arenapro.pause.adminpausedthematch"]);
                }
                else if ((string)pauseTeamName == "RoundRestore" && !(bool)unpauseData["t"] && !(bool)unpauseData["ct"])
                {
                    PrintToAllChat(Localizer["arenapro.pause.pausedbecauserestore"]);
                }
                else if ((bool)unpauseData["t"] && !(bool)unpauseData["ct"])
                {
                    PrintToAllChat(Localizer["arenapro.pause.teamwantstounpause", reverseTeamSides["TERRORIST"].teamName, reverseTeamSides["CT"].teamName]);
                }
                else if (!(bool)unpauseData["t"] && (bool)unpauseData["ct"])
                {
                    PrintToAllChat(Localizer["arenapro.pause.teamwantstounpause", reverseTeamSides["CT"].teamName, reverseTeamSides["TERRORIST"].teamName]);
                }
                else if (!(bool)unpauseData["t"] && !(bool)unpauseData["ct"])
                {
                    PrintToAllChat(Localizer["arenapro.pause.pausedthematch", pauseTeamName]);
                }
            }
        }

        // Kicks every bot except the CSTV/GOTV bot. A bare bot_kick also kicks CSTV, which stops GOTV and the demo recording.
        public void KickBots()
        {
            Server.ExecuteCommand("bot_quota 0"); // Otherwise the kicked bots are added again to fill the quota.
            List<CCSPlayerController> players;
            try
            {
                players = Utilities.GetPlayers();
            }
            catch (Exception)
            {
                // No map loaded yet (the plugin is loaded at server start and starts warmup): there are no bots to kick.
                return;
            }
            foreach (var bot in players)
            {
                if (bot == null || !bot.IsValid || !bot.IsBot || bot.IsHLTV || !bot.UserId.HasValue) continue;
                Server.ExecuteCommand($"kickid {bot.UserId.Value}");
            }
        }

        private static string? launchCommandLine;

        // Checks the server's launch options (e.g. -nobots). Inside CounterStrikeSharp the .NET command line is not the
        // server's on Linux, so it is read from /proc there.
        public static bool HasLaunchOption(string option)
        {
            if (launchCommandLine == null)
            {
                try
                {
                    launchCommandLine = OperatingSystem.IsLinux() && File.Exists("/proc/self/cmdline")
                        ? File.ReadAllText("/proc/self/cmdline").Replace('\0', ' ')
                        : Environment.CommandLine;
                }
                catch (Exception)
                {
                    launchCommandLine = Environment.CommandLine;
                }
            }
            return launchCommandLine.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                .Any(arg => arg.Equals(option, StringComparison.OrdinalIgnoreCase));
        }

        private void ExecWarmupCfg()
        {
            KickBots();
            var absolutePath = Path.Join(Server.GameDirectory + "/csgo/cfg", warmupCfgPath);

            if (File.Exists(Path.Join(Server.GameDirectory + "/csgo/cfg", warmupCfgPath)))
            {
                Log($"[StartWarmup] Starting warmup! Executing Warmup CFG from {warmupCfgPath}");
                Server.ExecuteCommand($"exec {warmupCfgPath}");
            }
            else
            {
                Log($"[StartWarmup] Starting warmup! Warmup CFG not found in {absolutePath}, using default CFG!");
                Server.ExecuteCommand("bot_quota 0;mp_autokick 0;mp_autoteambalance 0;mp_buy_anywhere 0;mp_buytime 15;mp_death_drop_gun 0;mp_free_armor 0;mp_ignore_round_win_conditions 0;mp_limitteams 0;mp_radar_showall 0;mp_respawn_on_death_ct 0;mp_respawn_on_death_t 0;mp_solid_teammates 0;mp_spectators_max 20;mp_maxmoney 16000;mp_startmoney 16000;mp_timelimit 0;sv_alltalk 0;sv_auto_full_alltalk_during_warmup_half_end 0;sv_deadtalk 1;sv_full_alltalk 0;sv_grenade_trajectory 0;sv_hibernate_when_empty 0;mp_weapons_allow_typecount -1;sv_infinite_ammo 0;sv_showimpacts 0;sv_voiceenable 1;sm_cvar sv_mute_players_with_social_penalties 0;sv_mute_players_with_social_penalties 0;tv_relayvoice 1;sv_cheats 0;mp_ct_default_melee weapon_knife;mp_ct_default_secondary weapon_hkp2000;mp_ct_default_primary \"\";mp_t_default_melee weapon_knife;mp_t_default_secondary weapon_glock;mp_t_default_primary;mp_maxrounds 24;mp_warmup_start;mp_warmup_pausetimer 1;mp_warmuptime 9999;cash_team_bonus_shorthanded 0;");
            }
            ExecOverrideCfg(warmupCfgPath);
        }

        private void StartWarmup()
        {
            unreadyPlayerMessageTimer?.Kill();
            unreadyPlayerMessageTimer = null;
            unreadyPlayerMessageTimer ??= AddTimer(chatTimerDelay, SendUnreadyPlayersMessage, TimerFlags.REPEAT);
            isWarmup = true;
            ExecWarmupCfg();
        }

        private void StartKnifeRound()
        {
            // Kills unready players message timer
            if (unreadyPlayerMessageTimer != null)
            {
                unreadyPlayerMessageTimer.Kill();
                unreadyPlayerMessageTimer = null;
            }

            // Setting match phases bools
            matchStarted = true;
            isKnifeRound = true;
            readyAvailable = false;
            isWarmup = false;

            var absolutePath = Path.Join(Server.GameDirectory + "/csgo/cfg", knifeCfgPath);

            if (File.Exists(Path.Join(Server.GameDirectory + "/csgo/cfg", knifeCfgPath)))
            {
                Log($"[StartKnifeRound] Starting Knife! Executing Knife CFG from {knifeCfgPath}");
                Server.ExecuteCommand($"exec {knifeCfgPath}");
                ExecOverrideCfg(knifeCfgPath);
                Server.ExecuteCommand("mp_restartgame 1;mp_warmup_end;");
            }
            else
            {
                Log($"[StartKnifeRound] Starting Knife! Knife CFG not found in {absolutePath}, using default CFG!");
                Server.ExecuteCommand("mp_ct_default_secondary \"\";mp_free_armor 1;mp_freezetime 10;mp_give_player_c4 0;mp_maxmoney 0;mp_respawn_immunitytime 0;mp_respawn_on_death_ct 0;mp_respawn_on_death_t 0;mp_roundtime 1.92;mp_roundtime_defuse 1.92;mp_roundtime_hostage 1.92;mp_t_default_secondary \"\";mp_round_restart_delay 3;mp_team_intro_time 0;mp_restartgame 1;mp_warmup_end;");
                ExecOverrideCfg(knifeCfgPath);
            }

            PrintToAllChat($"{ChatColors.Olive}KNIFE!");
            PrintToAllChat($"{ChatColors.Lime}KNIFE!");
            PrintToAllChat($"{ChatColors.Green}KNIFE!");
        }

        private void SendSideSelectionMessage()
        {
            if (!isSideSelectionPhase) return;
            PrintToAllChat(Localizer["arenapro.knife.sidedecisionpending", knifeWinnerName]);
            // Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{knifeWinnerName}{ChatColors.Default} Won the knife. Waiting for them to type {ChatColors.Green}.stay{ChatColors.Default} or {ChatColors.Green}.switch{ChatColors.Default}");
        }

        private void StartAfterKnifeWarmup()
        {
            isWarmup = true;
            ExecWarmupCfg();
            knifeWinnerName = knifeWinner == 3 ? reverseTeamSides["CT"].teamName : reverseTeamSides["TERRORIST"].teamName;
            ShowDamageInfo();
            PrintToAllChat(Localizer["arenapro.knife.sidedecisionpending", knifeWinnerName]);
            // Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{knifeWinnerName}{ChatColors.Default} Won the knife. Waiting for them to type {ChatColors.Green}.stay{ChatColors.Default} or {ChatColors.Green}.switch{ChatColors.Default}");
            sideSelectionMessageTimer ??= AddTimer(chatTimerDelay, SendSideSelectionMessage, TimerFlags.REPEAT);
        }

        private void SetLiveFlags()
        {
            // Setting match phases bools
            isWarmup = false;
            isSideSelectionPhase = false;
            matchStarted = true;
            isMatchLive = true;
            currentMapFinished = false;
            readyAvailable = false;
            isKnifeRound = false;
        }

        private void SetupLiveFlagsAndCfg()
        {
            SetLiveFlags();
            KillPhaseTimers();
            ExecLiveCFG();
            // Adding timer here to make sure that CFG execution is completed till then
            AddTimer(1, () =>
            {
                HandlePlayoutConfig();
                ExecuteChangedConvars();
            });
        }

        private void StartLive()
        {
            SetupLiveFlagsAndCfg();
            StartDemoRecordingAfterRestart(liveRestartDelay);

            // Storing 0-0 score backup file as lastBackupFileName, so that .stop functions properly in first round.
            lastBackupFileName = $"arenapro_{liveMatchId}_{matchConfig.CurrentMapNumber}_round00.txt";
            lastArenaProBackupFileName = $"arenapro_{liveMatchId}_{matchConfig.CurrentMapNumber}_round00.json";

            // This is to reload the map once it is over so that all flags are reset accordingly
            Server.ExecuteCommand("mp_match_end_restart true");

            PrintToAllChat($"{ChatColors.Olive}LIVE!");
            PrintToAllChat($"{ChatColors.Lime}LIVE!");
            PrintToAllChat($"{ChatColors.Green}LIVE!");

            var goingLiveEvent = new GoingLiveEvent
            {
                MatchId = liveMatchId,
                MapNumber = matchConfig.CurrentMapNumber,
            };

            Task.Run(async () =>
            {
                await SendEventAsync(goingLiveEvent);
            });
        }

        private void KillPhaseTimers()
        {
            unreadyPlayerMessageTimer?.Kill();
            sideSelectionMessageTimer?.Kill();
            pausedStateTimer?.Kill();
            unreadyPlayerMessageTimer = null;
            sideSelectionMessageTimer = null;
            pausedStateTimer = null;
        }

        private (int alivePlayers, int totalHealth) GetAlivePlayers(int team)
        {
            int count = 0;
            int totalHealth = 0;
            foreach (var key in playerData.Keys)
            {
                CCSPlayerController player = playerData[key];
                if (team == 2 && reverseTeamSides["TERRORIST"].coach.Contains(player)) continue;
                if (team == 3 && reverseTeamSides["CT"].coach.Contains(player)) continue;
                if (!IsPlayerValid(player)) continue;
                if (player.TeamNum == team)
                {
                    if (player.PlayerPawn.Value!.Health > 0) count++;
                    totalHealth += player.PlayerPawn.Value!.Health;
                }
            }
            return (count, totalHealth);
        }

        private void ResetMatch(bool warmupCfgRequired = true)
        {
            try
            {
                CancelPendingDemoRecording();
                ResetTechPauses();
                bombStats.Clear();
                pendingRestoreTechPauses = null;
                StopPauseTracking(false);
                seriesEnded = false;
                currentMapFinished = false;
                // We stop demo recording if a live match was restarted
                if (matchStarted && isDemoRecording)
                {
                    Server.ExecuteCommand($"tv_stoprecord");
                    isDemoRecording = false;
                }
                // Reset match data
                matchStarted = false;
                readyAvailable = true;
                isPaused = false;
                isMatchSetup = false;

                isWarmup = true;
                isKnifeRound = false;
                isSideSelectionPhase = false;
                isMatchLive = false;
                liveMatchId = -1;
                isPractice = false;
                isDryRun = false;
                isVeto = false;
                isPreVeto = false;

                lastBackupFileName = "";
                lastArenaProBackupFileName = "";

                isRoundRestorePending = false;
                playerHasTakenDamage = false;

                // Unready all players
                foreach (var key in playerReadyStatus.Keys)
                {
                    playerReadyStatus[key] = false;
                }

                teamReadyOverride = new()
                {
                    {CsTeam.Terrorist, false},
                    {CsTeam.CounterTerrorist, false},
                    {CsTeam.Spectator, false}
                };

                HandleClanTags();

                // Reset unpause data
                unpauseData = new()
                {
                    { "ct", false },
                    { "t", false },
                    { "pauseTeam", "" }
                };

                // Reset stop data
                stopData["ct"] = false;
                stopData["t"] = false;

                // Reset owned bots data
                CancelBotRequests();
                pracUsedBots = new Dictionary<int, Dictionary<string, object>>();
                noFlashList = new();
                lastGrenadesData = new();
                nadeSpecificLastGrenadeData = new();
                UnpauseMatch();

                arenaproTeam1.teamName = "COUNTER-TERRORISTS";
                arenaproTeam2.teamName = "TERRORISTS";

                arenaproTeam1.teamPlayers = null;
                arenaproTeam2.teamPlayers = null;

                HashSet<CCSPlayerController> coaches = GetAllCoaches();

                foreach (var coach in coaches)
                {
                    if (!IsPlayerValid(coach)) continue;
                    coach.Clan = "";
                    SetPlayerVisible(coach);
                }

                arenaproTeam1.coach = new();
                arenaproTeam2.coach = new();
                coachKillTimer?.Kill();
                coachKillTimer = null;

                arenaproTeam1.seriesScore = 0;
                arenaproTeam2.seriesScore = 0;

                Server.ExecuteCommand($"mp_teamname_1 \"{arenaproTeam1.teamName}\"");
                Server.ExecuteCommand($"mp_teamname_2 \"{arenaproTeam2.teamName}\"");

                teamSides[arenaproTeam1] = "CT";
                teamSides[arenaproTeam2] = "TERRORIST";
                reverseTeamSides["CT"] = arenaproTeam1;
                reverseTeamSides["TERRORIST"] = arenaproTeam2;

                // Back to the server's remote log settings (config.cfg), dropping any set by the match config.
                matchConfig = new();
                ApplyDefaultRemoteLogSettings();

                KillPhaseTimers();
                UpdatePlayersMap();
                if (warmupCfgRequired)
                {
                    StartWarmup();
                }
                else
                {
                    // Since we should be already in warmup phase by this point, we are just setting up the SendUnreadyPlayersMessage timer
                    unreadyPlayerMessageTimer?.Kill();
                    unreadyPlayerMessageTimer = null;
                    unreadyPlayerMessageTimer ??= AddTimer(chatTimerDelay, SendUnreadyPlayersMessage, TimerFlags.REPEAT);
                }
            }
            catch (Exception ex)
            {
                Log($"[ResetMatch - FATAL] [ERROR]: {ex.Message}");
            }
        }

        private void UpdatePlayersMap()
        {
            try
            {
                var playerEntities = Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>("cs_player_controller");
                Log($"[UpdatePlayersMap] CCSPlayerController count: {playerEntities.Count<CCSPlayerController>()} matchModeOnly: {matchModeOnly}");
                connectedPlayers = 0;

                // Clear the playerData dictionary by creating a new instance to add fresh data.
                playerData = new Dictionary<int, CCSPlayerController>();
                foreach (var player in playerEntities)
                {
                    if (player == null) continue;
                    if (!player.IsValid || player.IsBot || player.IsHLTV) continue;

                    if (isMatchSetup || matchModeOnly)
                    {
                        CsTeam team = GetPlayerTeam(player);
                        if (team == CsTeam.None && player.UserId.HasValue)
                        {
                            Server.ExecuteCommand($"kickid {(ushort)player.UserId}");
                            continue;
                        }
                    }

                    // A player controller still exists after a player disconnects
                    // Hence checking whether the player is actually in the server or not
                    if (player.Connected != PlayerConnectedState.Connected) continue;

                    if (player.UserId.HasValue)
                    {

                        // Updating playerData and playerReadyStatus
                        playerData[player.UserId.Value] = player;

                        // Adding missing player in playerReadyStatus
                        if (!playerReadyStatus.ContainsKey(player.UserId.Value))
                        {
                            playerReadyStatus[player.UserId.Value] = false;
                        }
                    }
                    connectedPlayers++;
                }

                // Removing disconnected players from playerReadyStatus
                foreach (var key in playerReadyStatus.Keys.ToList())
                {
                    if (!playerData.ContainsKey(key))
                    {
                        // Key is not present in playerData, so remove it from playerReadyStatus
                        playerReadyStatus.Remove(key);
                    }
                }
                Log($"[UpdatePlayersMap] CCSPlayerController count: {playerEntities.Count<CCSPlayerController>()}, RealPlayersCount: {GetRealPlayersCount()}");
            }
            catch (Exception e)
            {
                Log($"[UpdatePlayersMap FATAL] An error occurred: {e.Message}");
            }
        }

        public void DetermineKnifeWinner()
        {
            // Knife Round code referred from Get5, thanks to the Get5 team for their amazing job!
            (int tAlive, int tHealth) = GetAlivePlayers(2);
            (int ctAlive, int ctHealth) = GetAlivePlayers(3);
            Log($"[KNIFE OVER] CT Alive: {ctAlive} with Total Health: {ctHealth}, T Alive: {tAlive} with Total Health: {tHealth}");
            if (ctAlive > tAlive)
            {
                knifeWinner = 3;
            }
            else if (tAlive > ctAlive)
            {
                knifeWinner = 2;
            }
            else if (ctHealth > tHealth)
            {
                knifeWinner = 3;
            }
            else if (tHealth > ctHealth)
            {
                knifeWinner = 2;
            }
            else
            {
                // Choosing a winner randomly
                Random random = new();
                knifeWinner = random.Next(2, 4);
            }
        }

        private void HandleKnifeWinner(EventCsWinPanelRound @event)
        {
            DetermineKnifeWinner();
            // Below code is working partially (Winner audio plays correctly for knife winner team, but may display round winner incorrectly)
            // Hence we restart the game with StartAfterKnifeWarmup and allow the winning team to choose side

            @event.FunfactToken = "";

            // Commenting these assignments as they were crashing the server.
            // long empty = 0;
            // @event.FunfactPlayer = null;
            // @event.FunfactData1 = empty;
            // @event.FunfactData2 = empty;
            // @event.FunfactData3 = empty;
            int finalEvent = 10;
            if (knifeWinner == 3)
            {
                finalEvent = 8;
            }
            else if (knifeWinner == 2)
            {
                finalEvent = 9;
            }
            Log($"[KNIFE WINNER] Won by: {knifeWinner}, finalEvent: {@event.FinalEvent}, newFinalEvent: {finalEvent}");
            @event.FinalEvent = finalEvent;
        }

        private void HandleMapChangeCommand(CCSPlayerController? player, string mapName)
        {
            if (!IsPlayerAdmin(player, "css_map", "@css/map"))
            {
                SendPlayerNotAdminMessage(player);
                return;
            }

            if (matchStarted)
            {
                // ReplyToUserCommand(player, $"Map cannot be changed once the match is started!");
                ReplyToUserCommand(player, Localizer["arenapro.utility.matchstarted"]);
                return;
            }

            if (!long.TryParse(mapName, out _) && !mapName.Contains('_'))
            {
                mapName = "de_" + mapName;
            }

            if (long.TryParse(mapName, out _))
            { // Check if mapName is a long for workshop map ids
                KickBots();
                Server.ExecuteCommand($"host_workshop_map \"{mapName}\"");
            }
            else if (Server.IsMapValid(mapName))
            {
                KickBots();
                Server.ExecuteCommand($"changelevel \"{mapName}\"");
            }
            else
            {
                ReplyToUserCommand(player, $"Invalid map name!");
            }
        }

        private void HandleReadyRequiredCommand(CCSPlayerController? player, string commandArg)
        {
            if (!IsPlayerAdmin(player, "css_readyrequired", "@css/config"))
            {
                SendPlayerNotAdminMessage(player);
                return;
            }

            if (!string.IsNullOrWhiteSpace(commandArg))
            {
                if (int.TryParse(commandArg, out int readyRequired) && readyRequired >= 0 && readyRequired <= 32)
                {
                    minimumReadyRequired = readyRequired;
                    string minimumReadyRequiredFormatted = (player == null) ? $"{minimumReadyRequired}" : $"{ChatColors.Green}{minimumReadyRequired}{ChatColors.Default}";
                    // ReplyToUserCommand(player, $"Minimum ready players required to start the match are now set to: {minimumReadyRequiredFormatted}");
                    ReplyToUserCommand(player, Localizer["arenapro.utility.minreadyplayers", minimumReadyRequiredFormatted]);
                    CheckLiveRequired();
                }
                else
                {
                    // ReplyToUserCommand(player, $"Invalid value for readyrequired. Please specify a valid non-negative number. Usage: !readyrequired <number_of_ready_players_required>");
                    ReplyToUserCommand(player, Localizer["arenapro.utility.rrinvalidvalue"]);
                }
            }
            else
            {
                string minimumReadyRequiredFormatted = (player == null) ? $"{minimumReadyRequired}" : $"{ChatColors.Green}{minimumReadyRequired}{ChatColors.Default}";
                // ReplyToUserCommand(player, $"Current Ready Required: {minimumReadyRequiredFormatted} .Usage: !readyrequired <number_of_ready_players_required>");
                ReplyToUserCommand(player, Localizer["arenapro.utility.currentreadyrequired", minimumReadyRequiredFormatted]);
            }
        }

        // fromJoinCountdown: in join mode (arenapro_ready_mode 1) only the start countdown starts the match, so that .forceready
        // or other ready changes cannot skip it.
        private void CheckLiveRequired(bool fromJoinCountdown = false)
        {
            if (!readyAvailable || matchStarted) return;
            if (IsJoinReadyMode() && !fromJoinCountdown) return;

            // Todo: Implement a same ready system for both pug and match
            int countOfReadyPlayers = playerReadyStatus.Count(kv => kv.Value == true);
            bool liveRequired = false;
            if (isMatchSetup)
            {
                if (IsTeamsReady() && IsSpectatorsReady())
                {
                    liveRequired = true;
                }
            }
            else if (minimumReadyRequired == 0)
            {
                if (countOfReadyPlayers >= connectedPlayers && connectedPlayers > 0)
                {
                    liveRequired = true;
                }
            }
            else if (countOfReadyPlayers >= minimumReadyRequired)
            {
                liveRequired = true;
            }
            if (liveRequired)
            {
                HandleMatchStart();
            }
        }

        private void HandleMatchStart()
        {
            isPractice = false;
            isDryRun = false;
            if (isRoundRestorePending)
            {
                bool restoreStarted = RestoreRoundBackup(null, pendingRestoreFileName);
                isRoundRestorePending = false;
                pendingRestoreFileName = "";
                // A refused restore (e.g. incomplete round data) must not leave everyone ready in warmup: start normally.
                if (restoreStarted) return;
            }
            // If default names, we pick a player and use their name as their team name
            if (arenaproTeam1.teamName == "COUNTER-TERRORISTS")
            {
                // arenaproTeam1.teamName = teamName;
                teamSides[arenaproTeam1] = "CT";
                reverseTeamSides["CT"] = arenaproTeam1;
                foreach (var key in playerData.Keys)
                {
                    if (playerData[key].TeamNum == 3)
                    {
                        arenaproTeam1.teamName = "team_" + RemoveSpecialCharacters(playerData[key].PlayerName.Replace(" ", "_"));
                        foreach (var coach in arenaproTeam1.coach) {
                            coach.Clan = $"[{arenaproTeam1.teamName} COACH]";
                        }
                        break;
                    }
                }
                // Server.ExecuteCommand($"mp_teamname_1 \"{arenaproTeam1.teamName}\"");
            }

            if (arenaproTeam2.teamName == "TERRORISTS")
            {
                // arenaproTeam2.teamName = teamName;
                teamSides[arenaproTeam2] = "TERRORIST";
                reverseTeamSides["TERRORIST"] = arenaproTeam2;
                foreach (var key in playerData.Keys)
                {
                    if (playerData[key].TeamNum == 2)
                    {
                        arenaproTeam2.teamName = "team_" + RemoveSpecialCharacters(playerData[key].PlayerName.Replace(" ", "_"));
                        foreach (var coach in arenaproTeam2.coach) {
                            coach.Clan = $"[{arenaproTeam2.teamName} COACH]";
                        }
                        break;
                    }
                }
                // Server.ExecuteCommand($"mp_teamname_2 \"{arenaproTeam2.teamName}\"");
            }

            Server.ExecuteCommand($"mp_teamname_1 \"{reverseTeamSides["CT"].teamName}\"");
            Server.ExecuteCommand($"mp_teamname_2 \"{reverseTeamSides["TERRORIST"].teamName}\"");

            HandleClanTags();

            string seriesType = "BO" + matchConfig.NumMaps.ToString();
            liveMatchId = database.InitMatch(arenaproTeam1.teamName, arenaproTeam2.teamName, "-", isMatchSetup, liveMatchId, matchConfig.CurrentMapNumber, seriesType, matchConfig);
            SetupRoundBackupFile();

            GetSpawns();

            if (isPreVeto)
            {
                CreateVeto();
            }
            else if (isKnifeRequired)
            {
                StartKnifeRound();
            }
            else
            {
                StartLive();
            }
            if (showCreditsOnMatchStart.Value)
            {
                Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}ArenaPro{ChatColors.Default} Plugin by {ChatColors.Green}WD-{ChatColors.Default}");
            }
            if (matchStartMessage.Value.Trim() != "" && matchStartMessage.Value.Trim() != "\"\"")
            {
                List<string> matchStartMessages = [.. matchStartMessage.Value.Split("$$$")];
                foreach (string message in matchStartMessages)
                {
                    PrintToAllChat(GetColorTreatedString(FormatCvarValue(message.Trim())));
                }
            }
        }

        public void HandleClanTags()
        {
            // Currently it is not possible to keep updating player tags while in warmup without restarting the match
            // Hence returning from here until we find a proper solution
            return;

            if (readyAvailable && !matchStarted)
            {
                foreach (var key in playerData.Keys)
                {
                    if (playerReadyStatus[key])
                    {
                        playerData[key].Clan = "[Ready]";
                    }
                    else
                    {
                        playerData[key].Clan = "[Unready]";
                    }
                    Server.PrintToChatAll($"PlayerName: {playerData[key].PlayerName} Clan: {playerData[key].Clan}");
                }
            }
            else if (matchStarted)
            {
                foreach (var key in playerData.Keys)
                {
                    if (playerData[key].TeamNum == 2)
                    {
                        playerData[key].Clan = reverseTeamSides["TERRORIST"].teamTag;
                    }
                    else if (playerData[key].TeamNum == 3)
                    {
                        playerData[key].Clan = reverseTeamSides["CT"].teamTag;
                    }
                    Server.PrintToChatAll($"PlayerName: {playerData[key].PlayerName} Clan: {playerData[key].Clan}");
                }
            }
        }

        // True from the end of a map until the next map goes live.
        private bool currentMapFinished = false;

        private void HandleMatchEnd()
        {
            if (!isMatchLive) return;
            currentMapFinished = true;

            // This ensures that the mp_match_restart_delay is not shorter than what is required for the GOTV recording to finish.
            // Ref: Get5
            int restartDelay = ConVar<int>.Find("mp_match_restart_delay")!.Value;
            int tvDelay = GetTvDelay();
            int requiredDelay = tvDelay + 15;
            int tvFlushDelay = requiredDelay;
            if (tvDelay > 0.0)
            {
                requiredDelay += 10;
            }
            if (requiredDelay > restartDelay)
            {
                Log($"Extended mp_match_restart_delay from {restartDelay} to {requiredDelay} to ensure GOTV broadcast can finish.");
                ConVar<int>.Find("mp_match_restart_delay")!.Value = requiredDelay;
                restartDelay = requiredDelay;
            }
            int currentMapNumber = matchConfig.CurrentMapNumber;
            Log($"[HandleMatchEnd] MAP ENDED, isMatchSetup: {isMatchSetup} matchid: {liveMatchId} currentMapNumber: {currentMapNumber} tvFlushDelay: {tvFlushDelay}");

            StopDemoRecording(tvFlushDelay - 0.5f, activeDemoFile, liveMatchId, currentMapNumber);

            (int t1score, int t2score) = GetTeamsScore();
            Team? mapWinner = t1score > t2score ? arenaproTeam1 : t2score > t1score ? arenaproTeam2 : null;
            if (mapWinner != null) mapWinner.seriesScore++;
            PublishMapEnd(mapWinner, mapWinner?.teamName ?? "Draw", t1score, t2score);

            // If a match is not setup, it was supposed to be a pug/scrim with 1 map
            // Hence we reset the match once it is over
            // Todo: Support BO3/BO5 in pugs as well
            if (!isMatchSetup)
            {
                EndSeries(mapWinner, restartDelay - 1, t1score, t2score);
                return;
            }

            // Count maps played rather than maps won, so that a drawn map is counted too.
            int mapsPlayed = currentMapNumber + 1;
            SeriesOutcome outcome = SeriesLogic.GetOutcomeAfterMap(matchConfig.NumMaps, matchConfig.Maplist.Count, mapsPlayed,
                arenaproTeam1.seriesScore, arenaproTeam2.seriesScore, matchConfig.SeriesCanClinch);
            Log($"[HandleMatchEnd] MATCH ENDED, outcome: {outcome}, mapsPlayed: {mapsPlayed}, NumMaps: {matchConfig.NumMaps}, Team1SeriesScore: {arenaproTeam1.seriesScore}, Team2SeriesScore: {arenaproTeam2.seriesScore}");
            if (outcome != SeriesOutcome.Continue)
            {
                // A tie ends the series without a winner.
                EndSeries(GetSeriesLeader(), restartDelay - 1, t1score, t2score);
                return;
            }
            if (arenaproTeam1.seriesScore > arenaproTeam2.seriesScore)
            {
                Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{arenaproTeam1.teamName}{ChatColors.Default} is winning the series {ChatColors.Green}{arenaproTeam1.seriesScore}-{arenaproTeam2.seriesScore}{ChatColors.Default}");

            }
            else if (arenaproTeam2.seriesScore > arenaproTeam1.seriesScore)
            {
                Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{arenaproTeam2.teamName}{ChatColors.Default} is winning the series {ChatColors.Green}{arenaproTeam2.seriesScore}-{arenaproTeam1.seriesScore}{ChatColors.Default}");

            }
            else
            {
                Server.PrintToChatAll($"{chatPrefix} The series is tied at {ChatColors.Green}{arenaproTeam1.seriesScore}-{arenaproTeam2.seriesScore}{ChatColors.Default}");
            }
            matchConfig.CurrentMapNumber += 1;
            string nextMap = matchConfig.Maplist[matchConfig.CurrentMapNumber];

            if (isPaused)
                UnpauseMatch();

            stopData["ct"] = false;
            stopData["t"] = false;

            KillPhaseTimers();

            AddTimer(restartDelay - 4, () =>
            {
                if (!isMatchSetup) return;
                ChangeMap(nextMap, 3.0f);
                matchStarted = false;
                readyAvailable = true;
                isPaused = false;
                StopPauseTracking(false);

                isWarmup = true;
                isKnifeRound = false;
                isSideSelectionPhase = false;
                isMatchLive = false;
                isPractice = false;
                isDryRun = false;
                StartWarmup();
                SetMapSides();
            });
        }

        private void ChangeMap(string mapName, float delay)
        {
            Log($"[ChangeMap] Changing map to {mapName} with delay {delay}");
            AddTimer(delay, () =>
            {
                if (long.TryParse(mapName, out _))
                {
                    KickBots();
                    Server.ExecuteCommand($"host_workshop_map \"{mapName}\"");
                }
                else if (Server.IsMapValid(mapName))
                {
                    KickBots();
                    Server.ExecuteCommand($"changelevel \"{mapName}\"");
                }
            });
        }

        // Winner.side uses the game's team numbers ("3" = CT, "2" = T); "0" / "none" means a draw.
        private Winner GetTeamWinner(Team? winner)
        {
            if (winner == null) return new Winner("0", "none");
            string side = teamSides.TryGetValue(winner, out string? teamSide) && teamSide == "CT" ? "3" : "2";
            return new Winner(side, winner == arenaproTeam1 ? "team1" : "team2");
        }

        // eventWinner is the side that won the round (EventRoundEnd.Winner: 2 = T, 3 = CT).
        private Winner GetRoundWinner(int eventWinner)
        {
            Team? winner = eventWinner switch
            {
                (int)CsTeam.CounterTerrorist => reverseTeamSides["CT"],
                (int)CsTeam.Terrorist => reverseTeamSides["TERRORIST"],
                _ => null,
            };
            if (winner == null) return new Winner(eventWinner.ToString(), "none");
            return new Winner(eventWinner.ToString(), winner == arenaproTeam1 ? "team1" : "team2");
        }

        private Team? GetSeriesLeader()
        {
            if (arenaproTeam1.seriesScore > arenaproTeam2.seriesScore) return arenaproTeam1;
            if (arenaproTeam2.seriesScore > arenaproTeam1.seriesScore) return arenaproTeam2;
            return null;
        }

        // Sends map_result and writes the map's end data and stats CSV. Series scores must already include this map.
        // winnerName is stored in the database: a team name, "Draw", or "" for a map ended by an admin without a winner.
        public void PublishMapEnd(Team? winner, string winnerName, int t1score, int t2score)
        {
            long matchId = liveMatchId;
            int mapNumber = matchConfig.CurrentMapNumber;
            int team1SeriesScore = arenaproTeam1.seriesScore;
            int team2SeriesScore = arenaproTeam2.seriesScore;
            string statsPath = Server.GameDirectory + "/csgo/ArenaPro_Stats/" + matchId.ToString();
            RemoteLogTarget target = CurrentRemoteLogTarget();

            var mapResultEvent = new MapResultEvent
            {
                MatchId = matchId,
                MapNumber = mapNumber,
                Winner = GetTeamWinner(winner),
                StatsTeam1 = new ArenaProStatsTeam(arenaproTeam1.id, arenaproTeam1.teamName, team1SeriesScore, t1score, 0, 0, new List<StatsPlayer>()),
                StatsTeam2 = new ArenaProStatsTeam(arenaproTeam2.id, arenaproTeam2.teamName, team2SeriesScore, t2score, 0, 0, new List<StatsPlayer>())
            };

            Task.Run(async () => await SendEventAsync(mapResultEvent, target));
            // Queued after the last round's player stats, so the CSV includes them.
            database.SetMapEndData(matchId, mapNumber, winnerName, t1score, t2score, team1SeriesScore, team2SeriesScore);
            database.WritePlayerStatsToCsv(statsPath, matchId, mapNumber);
        }

        private (int t1score, int t2score) GetTeamsScore()
        {
            var teamEntities = Utilities.FindAllEntitiesByDesignerName<CCSTeam>("cs_team_manager");
            int t1score = 0;
            int t2score = 0;
            foreach (var team in teamEntities)
            {
                if (team.Teamname == teamSides[arenaproTeam1])
                {
                    t1score = team.Score;
                }
                else if (team.Teamname == teamSides[arenaproTeam2])
                {
                    t2score = team.Score;
                }
            }
            return (t1score, t2score);
        }

        private int GetRoundNumer()
        {
            (int t1score, int t2score) = GetTeamsScore();

            return t1score + t2score;
        }

        public void HandlePostRoundStartEvent(EventRoundStart @event)
        {
            if (isDryRun) RandomizeSpawns();
            if (!matchStarted) return;
            playerHasTakenDamage = false;
            HandleCoaches();
            CreateArenaProRoundDataBackup();
            InitPlayerDamageInfo();
            UpdateHostname();
        }

        private void HandlePostRoundEndEvent(EventRoundEnd @event)
        {
            try
            {
                if (isMatchLive)
                {
                    coachKillTimer?.Kill();
                    coachKillTimer = null;
                    (int t1score, int t2score) = GetTeamsScore();
                    Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{arenaproTeam1.teamName} [{t1score} - {t2score}] {arenaproTeam2.teamName}");

                    ShowDamageInfo();

                    (Dictionary<ulong, Dictionary<string, object>> playerStatsDictionary, List<StatsPlayer> playerStatsListTeam1, List<StatsPlayer> playerStatsListTeam2) = GetPlayerStatsDict();

                    int currentMapNumber = matchConfig.CurrentMapNumber;
                    long matchId = liveMatchId;
                    int ctTeamNum = reverseTeamSides["CT"] == arenaproTeam1 ? 1 : 2;
                    int tTeamNum = reverseTeamSides["TERRORIST"] == arenaproTeam1 ? 1 : 2;
                    Winner winner = GetRoundWinner(@event.Winner);

                    var roundEndEvent = new ArenaProRoundEndedEvent
                    {
                        MatchId = liveMatchId,
                        MapNumber = matchConfig.CurrentMapNumber,
                        // As in Get5: the rounds played when this round started (0 for the first round), the same as the
                        // round's player_death and bomb events, and milliseconds since freeze time ended.
                        RoundNumber = liveRoundNumber,
                        Reason = @event.Reason,
                        RoundTime = GetRoundTime(),
                        Winner = winner,
                        StatsTeam1 = new ArenaProStatsTeam(arenaproTeam1.id, arenaproTeam1.teamName, 0, t1score, 0, 0, playerStatsListTeam1),
                        StatsTeam2 = new ArenaProStatsTeam(arenaproTeam2.id, arenaproTeam2.teamName, 0, t2score, 0, 0, playerStatsListTeam2),
                    };

                    Task.Run(async () => await SendEventAsync(roundEndEvent));
                    // Queued here (not after the event is sent) so they are written before the map end data and CSV.
                    database.UpdatePlayerStatsAsync(matchId, currentMapNumber, playerStatsDictionary);
                    database.UpdateMapStatsAsync(matchId, currentMapNumber, t1score, t2score);

                    string round = GetRoundNumer().ToString("D2");
                    lastBackupFileName = $"arenapro_{liveMatchId}_{matchConfig.CurrentMapNumber}_round{round}.txt";
                    lastArenaProBackupFileName = $"arenapro_{liveMatchId}_{matchConfig.CurrentMapNumber}_round{round}.json";
                    Log($"[HandlePostRoundEndEvent] Setting lastBackupFileName to {lastBackupFileName} and lastArenaProBackupFileName to {lastArenaProBackupFileName}");

                    // One of the team did not use .stop command hence display the proper message after the round has ended.
                    if (stopData["ct"] && !stopData["t"])
                    {
                        Server.PrintToChatAll($"{chatPrefix} The round restore request by {ChatColors.Green}{reverseTeamSides["CT"].teamName}{ChatColors.Default} was cancelled as the round ended");
                    }
                    else if (!stopData["ct"] && stopData["t"])
                    {
                        Server.PrintToChatAll($"{chatPrefix} The round restore request by {ChatColors.Green}{reverseTeamSides["TERRORIST"].teamName}{ChatColors.Default} was cancelled as the round ended");
                    }

                    // Invalidate .stop requests after a round is completed.
                    stopData["ct"] = false;
                    stopData["t"] = false;

                    bool swapRequired = IsTeamSwapRequired();

                    // If isRoundRestoring is true, sides will be swapped from round restore if required!
                    if (swapRequired && !isRoundRestoring)
                    {
                        SwapSidesInTeamData(false);
                    }

                    isRoundRestoring = false;
                }
            }
            catch (Exception e)
            {
                Log($"[HandlePostRoundEndEvent FATAL] An error occurred: {e.Message}");
            }
        }

        public bool IsTeamSwapRequired()
        {
            // Handling OTs and side swaps (Referred from Get5)
            var gameRules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").First().GameRules!;
            int roundsPlayed = gameRules.TotalRoundsPlayed;

            int roundsPerHalf = ConVar<int>.Find("mp_maxrounds")!.Value / 2;
            int roundsPerOTHalf = ConVar<int>.Find("mp_overtime_maxrounds")!.Value / 2;

            bool halftimeEnabled = ConVar<bool>.Find("mp_halftime")!.Value;

            if (halftimeEnabled)
            {
                if (roundsPlayed == roundsPerHalf)
                {
                    return true;
                }
                // Now in OT.
                if (roundsPlayed >= 2 * roundsPerHalf)
                {
                    int otround = roundsPlayed - 2 * roundsPerHalf;  // round 33 -> round 3, etc.
                    // Do side swaps at OT halves (rounds 3, 9, ...)
                    if ((otround + roundsPerOTHalf) % (2 * roundsPerOTHalf) == 0)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private void PauseMatch(CCSPlayerController? player, CommandInfo? command)
        {
            if (isMatchLive && isPaused)
            {
                // ReplyToUserCommand(player, "Match is already paused!");
                ReplyToUserCommand(player, Localizer["arenapro.utility.paused"]);
                return;
            }
            if (IsHalfTimePhase())
            {
                // ReplyToUserCommand(player, "You cannot use this command during halftime.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.duringhalftime"]);
                return;
            }
            if (IsPostGamePhase())
            {
                // ReplyToUserCommand(player, "You cannot use this command after the game has ended.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.matchended"]);
                return;
            }
            if (IsTacticalTimeoutActive())
            {
                // ReplyToUserCommand(player, "You cannot use this command when tactical timeout is active.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.tacticaltimeout"]);
                return;
            }
            if (!techPauseEnabled.Value && player != null)
            {
                PrintToPlayerChat(player, Localizer["arenapro.pause.techpausenotenabled"]);
                return;
            }
            if(!string.IsNullOrEmpty(techPausePermission.Value) && techPausePermission.Value != "\"\"")
            {
                if (!IsPlayerAdmin(player, "css_pause", techPausePermission.Value))
                {
                    SendPlayerNotAdminMessage(player);
                    return;
                }
            }
            if (isMatchLive && !isPaused)
            {

                Team pausingTeam;
                if (player?.TeamNum == 2)
                {
                    pausingTeam = reverseTeamSides["TERRORIST"];
                }
                else if (player?.TeamNum == 3)
                {
                    pausingTeam = reverseTeamSides["CT"];
                }
                else
                {
                    return;
                }
                int teamNumber = pausingTeam == arenaproTeam1 ? 1 : 2;
                if (!PauseLogic.CanCallTechPause(techPausesUsed[teamNumber], maxTechPauses))
                {
                    PrintToAllChat(Localizer["arenapro.pause.notechpauseleft", pausingTeam.teamName]);
                    return;
                }
                string pauseTeamName = pausingTeam.teamName;
                unpauseData["pauseTeam"] = pauseTeamName;
                if (maxTechPauses > 0)
                {
                    // With a limit, say which of the team's technical pauses this is.
                    PrintToAllChat(Localizer["arenapro.pause.techpausecalled", pauseTeamName, techPausesUsed[teamNumber] + 1, maxTechPauses]);
                }
                else
                {
                    PrintToAllChat(Localizer["arenapro.pause.pausedthematch", pauseTeamName]);
                }
                // Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}{pauseTeamName}{ChatColors.Default} has paused the match. Type .unpause to unpause the match");

                SetMatchPausedFlags();
                StartPauseTracking(PauseType.Technical, teamNumber);
            }
        }

        private void ForcePauseMatch(CCSPlayerController? player, CommandInfo? command)
        {
            if (!matchStarted) return;
            if (!IsPlayerAdmin(player, "css_forcepause", "@css/config"))
            {
                SendPlayerNotAdminMessage(player);
                return;
            }
            if (isMatchLive && isPaused)
            {
                // ReplyToUserCommand(player, "Match is already paused!");
                ReplyToUserCommand(player, Localizer["arenapro.utility.paused"]);
                return;
            }
            if (IsHalfTimePhase())
            {
                // ReplyToUserCommand(player, "You cannot use this command during halftime.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.duringhalftime"]);
                return;
            }
            if (IsPostGamePhase())
            {
                // ReplyToUserCommand(player, "You cannot use this command after the game has ended.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.matchended"]);
                return;
            }
            if (IsTacticalTimeoutActive())
            {
                // ReplyToUserCommand(player, "You cannot use this command when tactical timeout is active.");
                ReplyToUserCommand(player, Localizer["arenapro.utility.tacticaltimeout"]);
                return;
            }
            unpauseData["pauseTeam"] = "Admin";
            PrintToAllChat(Localizer["arenapro.pause.adminpausedthematch"]);
            // Server.PrintToChatAll($"{chatPrefix} {ChatColors.Green}Admin{ChatColors.Default} has paused the match.");
            if (player == null)
            {
                Server.PrintToConsole($"[ArenaPro] {Localizer["arenapro.pause.adminpausedthematch"]}");
            }
            SetMatchPausedFlags();
            StartPauseTracking(PauseType.Admin, 0);
        }

        private void ForceUnpauseMatch(CCSPlayerController? player, CommandInfo? command)
        {
            if (matchStarted && isPaused)
            {
                if (!IsPlayerAdmin(player, "css_forceunpause", "@css/config"))
                {
                    SendPlayerNotAdminMessage(player);
                    return;
                }
                PrintToAllChat(Localizer["arenapro.pause.adminunpausedthematch"]);
                UnpauseMatch();

                if (player == null)
                {
                    Server.PrintToConsole("[ArenaPro] Admin has unpaused the match, resuming the match!");
                }
            }
        }

        private void UnpauseMatch()
        {
            Server.ExecuteCommand("mp_unpause_match;");
            isPaused = false;
            StopPauseTracking();
            unpauseData["ct"] = false;
            unpauseData["t"] = false;
            if (!isPaused && pausedStateTimer != null)
            {
                pausedStateTimer.Kill();
                pausedStateTimer = null;
            }
        }

        private void SetMatchPausedFlags()
        {
            coachKillTimer?.Kill();
            coachKillTimer = null;

            Server.ExecuteCommand("mp_pause_match;");
            isPaused = true;

            pausedStateTimer ??= AddTimer(chatTimerDelay, SendPausedStateMessage, TimerFlags.REPEAT);
        }

        private void StartMatchMode()
        {
            if (matchStarted || (!isPractice && !isSleep)) return;
            ExecUnpracCommands();
            ResetMatch();
            RemoveSpawnBeams();
            Server.PrintToChatAll($"{chatPrefix} Match mode loaded!");
        }

        // Seconds until the mp_restartgame run by ExecLiveCFG restarts the game.
        private float liveRestartDelay = 1;

        private void ExecLiveCFG()
        {
            int gameMode = GetGameMode();

            var cfgPath = liveCfgPath;
            var absolutePath = Path.Join(Server.GameDirectory + "/csgo/cfg", liveCfgPath);

            if (gameMode == 2)
            {
                absolutePath = Path.Join(Server.GameDirectory + "/csgo/cfg", liveWingmanCfgPath);
                cfgPath = liveWingmanCfgPath;
            }

            // We try to find the CFG in the cfg folder, if it is not there then we execute the default CFG.
            if (File.Exists(absolutePath))
            {
                Log($"[StartLive] Starting Live! Executing Live CFG from {cfgPath}");
                Server.ExecuteCommand($"exec {cfgPath}");
                ExecOverrideCfg(cfgPath);
                Server.ExecuteCommand("mp_restartgame 1;mp_warmup_end;");
                liveRestartDelay = 1;
            }
            else
            {
                Log($"[StartLive] Starting Live! Live CFG not found in {absolutePath}, using default CFG!");
                if (gameMode == 2)
                {
                    Server.ExecuteCommand("ammo_grenade_limit_default 1;ammo_grenade_limit_flashbang 2;ammo_grenade_limit_total 4;bot_quota 0;cash_player_bomb_defused 300;cash_player_bomb_planted 300;cash_player_damage_hostage -30;cash_player_interact_with_hostage 300;cash_player_killed_enemy_default 300;cash_player_killed_enemy_factor 1;cash_player_killed_hostage -1000;cash_player_killed_teammate -300;cash_player_rescued_hostage 1000;cash_team_bonus_shorthanded 1000;cash_team_elimination_bomb_map 2750;cash_team_elimination_hostage_map_ct 2500;cash_team_elimination_hostage_map_t 2500;cash_team_hostage_alive 0;cash_team_hostage_interaction 600;cash_team_loser_bonus 2000;cash_team_loser_bonus_consecutive_rounds 300;cash_team_planted_bomb_but_defused 600;cash_team_rescued_hostage 600;cash_team_terrorist_win_bomb 3000;cash_team_win_by_defusing_bomb 3000;cash_team_win_by_hostage_rescue 2900;cash_team_win_by_time_running_out_bomb 2750;cash_team_win_by_time_running_out_hostage 2750;ff_damage_reduction_bullets 0.33;ff_damage_reduction_grenade 0.85;ff_damage_reduction_grenade_self 1;ff_damage_reduction_other 0.4;mp_afterroundmoney 0;mp_autokick 0;mp_autoteambalance 0;mp_backup_restore_load_autopause 0;mp_backup_round_auto 1;mp_buy_anywhere 0;mp_buy_during_immunity 0;mp_buytime 20;mp_c4timer 40;mp_ct_default_melee weapon_knife;mp_ct_default_primary \"\";mp_ct_default_secondary weapon_hkp2000;mp_death_drop_defuser 1;mp_death_drop_grenade 2;mp_death_drop_gun 1;mp_defuser_allocation 0;mp_display_kill_assists 1;mp_endmatch_votenextmap 0;mp_forcecamera 1;mp_free_armor 0;mp_freezetime 10;mp_friendlyfire 1;mp_give_player_c4 1;mp_halftime 1;mp_halftime_duration 15;mp_halftime_pausetimer 0;mp_ignore_round_win_conditions 0;mp_limitteams 0;mp_match_can_clinch 1;mp_match_end_restart 1;mp_maxmoney 8000;");
                    Server.ExecuteCommand("mp_maxrounds 16;mp_overtime_enable 1;mp_overtime_halftime_pausetimer 0;mp_overtime_maxrounds 4;mp_overtime_startmoney 8000;mp_playercashawards 1;mp_randomspawn 0;mp_respawn_immunitytime 0;mp_respawn_on_death_ct 0;mp_respawn_on_death_t 0;mp_round_restart_delay 7;mp_roundtime 1.5;mp_roundtime_defuse 1.5;mp_roundtime_hostage 1.5;mp_solid_teammates 1;mp_starting_losses 1;mp_startmoney 800;mp_t_default_melee weapon_knife;mp_t_default_primary \"\";mp_t_default_secondary weapon_glock;mp_teamcashawards 1;mp_timelimit 0;mp_weapons_allow_map_placed 1;mp_weapons_allow_zeus 1;mp_win_panel_display_time 3;spec_freeze_deathanim_time 0;spec_freeze_time 2;spec_freeze_time_lock 2;spec_replay_enable 0;sv_allow_votes 0;sv_auto_full_alltalk_during_warmup_half_end 0;sv_damage_print_enable 0;sv_deadtalk 1;sv_hibernate_postgame_delay 300;sv_ignoregrenaderadio 0;sv_infinite_ammo 0;sv_talk_enemy_dead 0;sv_talk_enemy_living 0;sv_voiceenable 1;tv_relayvoice 0");
                }
                else
                {
                    Server.ExecuteCommand("ammo_grenade_limit_default 1;ammo_grenade_limit_flashbang 2;ammo_grenade_limit_total 4;bot_quota 0;cash_player_bomb_defused 300;cash_player_bomb_planted 300;cash_player_damage_hostage -30;cash_player_interact_with_hostage 300;cash_player_killed_enemy_default 300;cash_player_killed_enemy_factor 1;cash_player_killed_hostage -1000;cash_player_killed_teammate -300;cash_player_rescued_hostage 1000;cash_team_elimination_bomb_map 3250;cash_team_elimination_hostage_map_ct 3000;cash_team_elimination_hostage_map_t 3000;cash_team_hostage_alive 0;cash_team_hostage_interaction 600;cash_team_loser_bonus 1400;cash_team_loser_bonus_consecutive_rounds 500;cash_team_planted_bomb_but_defused 600;cash_team_rescued_hostage 600;cash_team_terrorist_win_bomb 3500;cash_team_win_by_defusing_bomb 3500;");
                    Server.ExecuteCommand("cash_team_win_by_hostage_rescue 2900;cash_team_win_by_time_running_out_bomb 3250;cash_team_win_by_time_running_out_hostage 3250;ff_damage_reduction_bullets 0.33;ff_damage_reduction_grenade 0.85;ff_damage_reduction_grenade_self 1;ff_damage_reduction_other 0.4;mp_afterroundmoney 0;mp_autokick 0;mp_autoteambalance 0;mp_backup_restore_load_autopause 1;mp_backup_round_auto 1;mp_buy_anywhere 0;mp_buy_during_immunity 0;mp_buytime 20;mp_c4timer 40;mp_ct_default_melee weapon_knife;mp_ct_default_primary \"\";mp_ct_default_secondary weapon_hkp2000;mp_death_drop_defuser 1;mp_death_drop_grenade 2;mp_death_drop_gun 1;mp_defuser_allocation 0;mp_display_kill_assists 1;mp_endmatch_votenextmap 0;mp_forcecamera 1;mp_free_armor 0;mp_freezetime 18;mp_friendlyfire 1;mp_give_player_c4 1;mp_halftime 1;mp_halftime_duration 15;mp_halftime_pausetimer 0;mp_ignore_round_win_conditions 0;mp_limitteams 0;mp_match_can_clinch 1;mp_match_end_restart 0;mp_maxmoney 16000;mp_maxrounds 24;mp_overtime_enable 1;mp_overtime_halftime_pausetimer 0;mp_overtime_maxrounds 6;mp_overtime_startmoney 10000;mp_playercashawards 1;mp_randomspawn 0;mp_respawn_immunitytime 0;mp_respawn_on_death_ct 0;mp_respawn_on_death_t 0;mp_round_restart_delay 5;mp_roundtime 1.92;mp_roundtime_defuse 1.92;mp_roundtime_hostage 1.92;mp_solid_teammates 1;mp_starting_losses 1;mp_startmoney 800;mp_t_default_melee weapon_knife;mp_t_default_primary \"\";mp_t_default_secondary weapon_glock;mp_teamcashawards 1;mp_timelimit 0;mp_weapons_allow_map_placed 1;mp_weapons_allow_zeus 1;mp_win_panel_display_time 3;spec_freeze_deathanim_time 0;spec_freeze_time 2;spec_freeze_time_lock 2;spec_replay_enable 0;sv_allow_votes 1;sv_auto_full_alltalk_during_warmup_half_end 0;sv_damage_print_enable 0;sv_deadtalk 1;sv_hibernate_postgame_delay 300;sv_ignoregrenaderadio 0;sv_infinite_ammo 0;sv_talk_enemy_dead 0;sv_talk_enemy_living 0;sv_voiceenable 1;tv_relayvoice 1;mp_team_timeout_max 3;mp_team_timeout_ot_max 1;mp_team_timeout_ot_add_each 1;mp_team_timeout_time 30;sv_vote_command_delay 0;cash_team_bonus_shorthanded 0;mp_spectators_max 20;mp_team_intro_time 0;mp_restartgame 3;mp_warmup_end;");
                    liveRestartDelay = 3;
                }
                ExecOverrideCfg(cfgPath);
            }
        }

        // ArenaPro/live.cfg -> ArenaPro/live_override.cfg
        private static string OverrideCfgPath(string cfgPath) => Path.ChangeExtension(cfgPath, null) + "_override.cfg";

        // Runs the admin's ArenaPro/<name>_override.cfg, if there is one, after ArenaPro/<name>.cfg (or after the default CFG
        // when that is missing). Releases don't contain override CFGs, so updates don't overwrite the settings in them.
        private void ExecOverrideCfg(string cfgPath)
        {
            string overrideCfgPath = OverrideCfgPath(cfgPath);
            if (!File.Exists(Path.Join(Server.GameDirectory + "/csgo/cfg", overrideCfgPath))) return;
            Log($"Executing override CFG {overrideCfgPath}");
            Server.ExecuteCommand($"exec {overrideCfgPath}");
        }

        private void SendPlayerNotAdminMessage(CCSPlayerController? player)
        {
            // ReplyToUserCommand(player, "You do not have permission to use this command!");
            // An admin who has not typed the admin code yet is told how to unlock the command instead
            if (player != null && !everyoneIsAdmin.Value && !adminAuth.IsAuthorized(player.SteamID) && IsPlayerAdminIgnoringAuth(player, "", "@css/generic", "@custom/prac", "@css/map", "@css/config"))
            {
                ReplyToUserCommand(player, Localizer["arenapro.auth.required"]);
                return;
            }
            ReplyToUserCommand(player, Localizer["arenapro.utility.dontpermission"]);
        }

        private string GetColorTreatedString(string message)
        {
            // Adding extra space before args if message starts with a color name
            // This is because colors cannot be applied from 1st character, hence we make first character as an empty space
            if (message.StartsWith('{')) message = " " + message;

            foreach (var field in typeof(ChatColors).GetFields())
            {
                string pattern = $"{{{field.Name}}}";
                string? replacement = field.GetValue(null)?.ToString();

                if (replacement is null) return message;

                // Create a case-insensitive regular expression pattern for the color name
                string patternIgnoreCase = Regex.Escape(pattern);
                message = Regex.Replace(message, patternIgnoreCase, replacement, RegexOptions.IgnoreCase);
            }

            return message;
        }

        private void SendAvailableCommandsMessage(CCSPlayerController? player)
        {
            if (!IsPlayerValid(player)) return;

            ReplyToUserCommand(player, "Available commands:");

            if (isPractice)
            {
                player!.PrintToChat($" {ChatColors.Green}Spawns: {ChatColors.Default}.spawn, .ctspawn, .tspawn, .bestspawn, .worstspawn");
                player.PrintToChat($" {ChatColors.Green}Bots: {ChatColors.Default}.bot, .nobots, .crouchbot, .boost, .crouchboost");
                player.PrintToChat($" {ChatColors.Green}Nades: {ChatColors.Default}.loadnade, .savenade, .importnade, .listnades");
                player.PrintToChat($" {ChatColors.Green}Nade Throw: {ChatColors.Default}.rethrow, .throwindex <index>, .lastindex, .delay <number>");
                player.PrintToChat($" {ChatColors.Green}Utility & Toggles: {ChatColors.Default}.clear, .fastforward, .last, .back, .solid, .impacts, .traj");
                player.PrintToChat($" {ChatColors.Green}Utility & Toggles: {ChatColors.Default}.savepos, .loadpos");
                player.PrintToChat($" {ChatColors.Green}Sides & Others: {ChatColors.Default}.ct, .t, .spec, .fas, .god, .dryrun, .break, .exitprac");
                return;
            }
            if (readyAvailable)
            {
                player!.PrintToChat($" {ChatColors.Green}Ready/Unready: {ChatColors.Default}.ready, .unready");
                return;
            }
            if (isSideSelectionPhase)
            {
                player!.PrintToChat($" {ChatColors.Green}Side Selection: {ChatColors.Default}.stay, .switch, .ct, .t");
                return;
            }
            if (matchStarted)
            {
                string stopCommandMessage = isStopCommandAvailable ? ", .stop" : "";
                player!.PrintToChat($" {ChatColors.Green}Pause/Restore: {ChatColors.Default}.pause, .unpause, .tac, .tech{stopCommandMessage}");
                return;
            }
        }

        public void LoadClientNames()
        {
            string namesFileName = "Match_" + liveMatchId.ToString() + ".ini";
            string namesFilePath = Server.GameDirectory + "/csgo/ArenaProPlayerNames/" + namesFileName;
            string? directoryPath = Path.GetDirectoryName(namesFilePath);
            if (directoryPath != null)
            {
                if (!Directory.Exists(directoryPath))
                {
                    Directory.CreateDirectory(directoryPath);
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("\"Names\"");
            sb.AppendLine("{");

            WriteClientNamesInFile(sb, arenaproTeam1.teamPlayers);
            WriteClientNamesInFile(sb, arenaproTeam2.teamPlayers);
            WriteClientNamesInFile(sb, matchConfig.Spectators);

            sb.AppendLine("}");
            File.WriteAllText(namesFilePath, sb.ToString());
            Server.ExecuteCommand($"sv_load_forced_client_names_file ArenaProPlayerNames/" + namesFileName);
        }

        public void WriteClientNamesInFile(StringBuilder sb, JToken? players)
        {
            if (players == null) return;
            foreach (JProperty player in players)
            {
                string steamId = player.Name;
                string escapedName = player.Value.ToString().Replace("\"", "\\\"").Trim();

                if (string.IsNullOrEmpty(escapedName)) continue;

                sb.AppendLine($"\t\"{steamId}\"\t\t\"{escapedName}\"");
            }
        }

        static bool IsValidUrl(string url)
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out Uri? result))
            {
                return result != null && (result.Scheme == Uri.UriSchemeHttp || result.Scheme == Uri.UriSchemeHttps);
            }
            return false;
        }

        // Convars looked up by name at run time (match config cvars, settings read back by name) have a type that is only
        // known from the convar itself, so ConVar<T> cannot be used. These helpers are the only place that still uses
        // the non-generic ConVar, which CounterStrikeSharp marks obsolete. Convars with a fixed name use ConVar<T>.Find.
#pragma warning disable CS0618
        public bool ConVarExists(string name) => ConVar.Find(name) != null;

        public string GetConvarStringValue(string name)
        {
            try
            {
                var cvar = ConVar.Find(name);
                if (cvar == null) return "";
                string convarValue = cvar.Type switch
                {
                    // "1"/"0" and invariant-culture numbers, so the value can be executed as a console command on any server locale.
                    ConVarType.Bool => cvar.GetPrimitiveValue<bool>() ? "1" : "0",
                    ConVarType.Float32 => cvar.GetPrimitiveValue<float>().ToString(CultureInfo.InvariantCulture),
                    ConVarType.Float64 => cvar.GetPrimitiveValue<double>().ToString(CultureInfo.InvariantCulture),
                    ConVarType.UInt16 => cvar.GetPrimitiveValue<ushort>().ToString(),
                    ConVarType.Int16 => cvar.GetPrimitiveValue<short>().ToString(),
                    ConVarType.UInt32 => cvar.GetPrimitiveValue<uint>().ToString(),
                    ConVarType.Int32 => cvar.GetPrimitiveValue<int>().ToString(),
                    ConVarType.Int64 => cvar.GetPrimitiveValue<long>().ToString(),
                    ConVarType.UInt64 => cvar.GetPrimitiveValue<ulong>().ToString(),
                    ConVarType.String => cvar.StringValue,
                    _ => "",
                };
                return convarValue;
            }
            catch (Exception ex)
            {
                Log($"[GetConvarStringValue - FATAL] Exception occurred: {ex.Message}");
                return "";
            }

        }

        public void SetConvarValue(string name, string value)
        {
            var cvar = ConVar.Find(name);
            if (cvar == null) return;
            Dictionary<ConVarType, Action<string>> conversionMap = new()
            {
                { ConVarType.Bool, v => cvar.SetValue(int.TryParse(v, out int intValue) ? intValue >= 1 : Convert.ToBoolean(v)) },
                { ConVarType.Float32, v => cvar.SetValue(Convert.ToSingle(v, CultureInfo.InvariantCulture)) },
                { ConVarType.Float64, v => cvar.SetValue(Convert.ToDouble(v, CultureInfo.InvariantCulture)) },
                { ConVarType.UInt16, v => cvar.SetValue(Convert.ToUInt16(v)) },
                { ConVarType.Int16, v => cvar.SetValue(Convert.ToInt16(v)) },
                { ConVarType.UInt32, v => cvar.SetValue(Convert.ToUInt32(v)) },
                { ConVarType.Int32, v => cvar.SetValue(Convert.ToInt32(v)) },
                { ConVarType.Int64, v => cvar.SetValue(Convert.ToInt64(v)) },
                { ConVarType.UInt64, v => cvar.SetValue(Convert.ToUInt64(v)) },
                { ConVarType.String, v => cvar.SetValue(v) },
            };

            if (conversionMap.TryGetValue(cvar.Type, out var conversion))
            {
                try
                {
                    conversion(value);
                }
                catch (Exception ex)
                {
                    Log($"[SetConvarValue - FATAL] Exception occurred: {ex.Message}");
                }
            }
        }
#pragma warning restore CS0618
#pragma warning restore CS0618

        private HashSet<string>? arenaProFakeConVarNames;

        // Names of every FakeConVar setting this plugin registers (e.g. arenapro_enable_damage_report).
        private HashSet<string> GetArenaProFakeConVarNames()
        {
            return arenaProFakeConVarNames ??= new HashSet<string>(GetFakeConVarsByName().Keys, StringComparer.OrdinalIgnoreCase);
        }

        public bool IsAllowedMatchCvar(string name, string value, out string reason)
        {
            return ArenaProSecurity.IsAllowedMatchCvar(name, value, ConVarExists, GetArenaProFakeConVarNames(), out reason);
        }

        public void ExecuteChangedConvars()
        {
            foreach (string key in matchConfig.ChangedCvars.Keys)
            {
                string value = matchConfig.ChangedCvars[key];
                // Checked again here because matchConfig can also come from a backup file.
                if (!IsAllowedMatchCvar(key, value, out string reason))
                {
                    Log($"[ExecuteChangedConvars] Ignoring cvar {key}: {reason}");
                    continue;
                }
                if (remoteLogCvars.Contains(key))
                {
                    // Applied to this match only, so the next match does not inherit it.
                    ApplyMatchRemoteLogCvar(key, value);
                    continue;
                }
                Log($"[ExecuteChangedConvars] Execing: {key} \"{(ArenaProSecurity.IsSecretCvar(key) ? "<redacted>" : value)}\"");
                Server.ExecuteCommand($"{key} \"{value}\"");
            }
        }

        public void ResetChangedConvars()
        {
            foreach (string key in matchConfig.OriginalCvars.Keys)
            {
                // Original values were read from the server itself, but the keys may come from a backup file: only the names a
                // match config may set are accepted (the value is checked below, it may legitimately contain ';').
                if (!IsAllowedMatchCvar(key, "", out string reason))
                {
                    Log($"[ResetChangedConvars] Ignoring cvar {key}: {reason}");
                    continue;
                }
                string value = matchConfig.OriginalCvars[key];
                string loggedValue = ArenaProSecurity.IsSecretCvar(key) ? "<redacted>" : value;
                if (GetPluginSettings().TryGetValue(key, out var pluginSetting))
                {
                    // ArenaPro setting: written back directly (their commands cannot set some values, e.g. an empty URL).
                    // The value can come from a backup file, so it is checked like a value from a match config.
                    if (!ArenaProSecurity.IsQuotableValue(value) || (pluginSetting.IsValid != null && !pluginSetting.IsValid(value)))
                    {
                        Log($"[ResetChangedConvars] Ignoring {key}: invalid value");
                        continue;
                    }
                    Log($"[ResetChangedConvars] Restoring {key} to \"{loggedValue}\"");
                    pluginSetting.Set(value);
                    continue;
                }
                if (ArenaProSecurity.IsQuotableValue(value))
                {
                    Log($"[ResetChangedConvars] Execing: {key} \"{loggedValue}\"");
                    Server.ExecuteCommand($"{key} \"{value}\"");
                }
                else
                {
                    // A value that cannot be quoted safely is set directly instead of through the console.
                    Log($"[ResetChangedConvars] Setting {key} to {loggedValue} directly");
                    SetConvarValue(key, value);
                }
            }
        }

        public string FormatCvarValue(string value)
        {
            string formattedTime = DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss");
            (int team1Score, int team2Score) = GetTeamsScore();

            var formattedValue = value
                .Replace("{TIME}", formattedTime.Replace(" ", "_"))
                .Replace("{MATCH_ID}", $"{liveMatchId}")
                .Replace("{MAP}", Server.MapName)
                .Replace("{MAPNUMBER}", matchConfig.CurrentMapNumber.ToString())
                .Replace("{TEAM1}", arenaproTeam1.teamName.Replace(" ", "_"))
                .Replace("{TEAM2}", arenaproTeam2.teamName.Replace(" ", "_"))
                .Replace("{TEAM1_SCORE}", team1Score.ToString())
                .Replace("{TEAM2_SCORE}", team2Score.ToString());
            return formattedValue;
        }

        public void UpdateHostname()
        {
            string hostname = hostnameFormat.Value.Trim();
            if (hostname == "" || hostname == "\"\"") return;
            string formattedHostname = FormatCvarValue(hostname);
            Log($"UPDATING HOSTNAME TO: {formattedHostname}");
            Server.ExecuteCommand($"hostname {formattedHostname}");
        }

        public CCSGameRules GetGameRules()
        {
            return Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").First().GameRules!;
        }

        public int GetGamePhase()
        {
            return GetGameRules().GamePhase;
        }

        public bool IsHalfTimePhase()
        {
            try
            {
                return GetGamePhase() == 4;
            }
            catch (Exception e)
            {
                Log($"[IsHalfTime FATAL] An error occurred: {e.Message}");
                return false;
            }

        }

        public bool IsPostGamePhase()
        {
            try
            {
                return GetGamePhase() == 5;
            }
            catch (Exception e)
            {
                Log($"[IsPostGamePhase FATAL] An error occurred: {e.Message}");
                return false;
            }

        }

        public bool IsTacticalTimeoutActive()
        {
            var gameRules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").First().GameRules!;

            return (gameRules.CTTimeOutActive || gameRules.TerroristTimeOutActive) && gameRules.FreezePeriod;
        }

        public (Dictionary<ulong, Dictionary<string, object>>, List<StatsPlayer>, List<StatsPlayer>) GetPlayerStatsDict()
        {
            Dictionary<ulong, Dictionary<string, object>> playerStatsDictionary = new Dictionary<ulong, Dictionary<string, object>>();
            List<StatsPlayer> playerStatsListTeam1 = new();
            List<StatsPlayer> playerStatsListTeam2 = new();
            var gameRules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").First().GameRules!;
            int roundsPlayed = gameRules.TotalRoundsPlayed;
            try
            {
                foreach (int key in playerData.Keys)
                {
                    CCSPlayerController player = playerData[key];
                    if (!player.IsValid || player.ActionTrackingServices == null) continue;

                    var playerStats = player.ActionTrackingServices.MatchStats;
                    ulong steamid64 = player.SteamID;

                    // Create a nested dictionary to store individual stats for the player
                    Dictionary<string, object> stats = new Dictionary<string, object>
                    {
                        { "PlayerName", player.PlayerName },
                        { "Kills", playerStats.Kills },
                        { "Deaths", playerStats.Deaths },
                        { "Assists", playerStats.Assists },
                        { "Damage", playerStats.Damage },
                        { "Enemy2Ks", playerStats.Enemy2Ks },
                        { "Enemy3Ks", playerStats.Enemy3Ks },
                        { "Enemy4Ks", playerStats.Enemy4Ks },
                        { "Enemy5Ks", playerStats.Enemy5Ks },
                        { "EntryCount", playerStats.EntryCount },
                        { "EntryWins", playerStats.EntryWins },
                        { "1v1Count", playerStats.I1v1Count },
                        { "1v1Wins", playerStats.I1v1Wins },
                        { "1v2Count", playerStats.I1v2Count },
                        { "1v2Wins", playerStats.I1v2Wins },
                        { "UtilityCount", playerStats.Utility_Count },
                        { "UtilitySuccess", playerStats.Utility_Successes },
                        { "UtilityDamage", playerStats.UtilityDamage },
                        { "UtilityEnemies", playerStats.Utility_Enemies },
                        { "FlashCount", playerStats.Flash_Count },
                        { "FlashSuccess", playerStats.Flash_Successes },
                        { "HealthPointsRemovedTotal", playerStats.HealthPointsRemovedTotal },
                        { "HealthPointsDealtTotal", playerStats.HealthPointsDealtTotal },
                        { "ShotsFiredTotal", playerStats.ShotsFiredTotal },
                        { "ShotsOnTargetTotal", playerStats.ShotsOnTargetTotal },
                        { "EquipmentValue", playerStats.EquipmentValue },
                        { "MoneySaved", playerStats.MoneySaved },
                        { "KillReward", playerStats.KillReward },
                        { "LiveTime", playerStats.LiveTime },
                        { "HeadShotKills", playerStats.HeadShotKills },
                        { "CashEarned", playerStats.CashEarned },
                        { "EnemiesFlashed", playerStats.EnemiesFlashed }
                    };

                    string teamName = "Spectator";
                    if (player.TeamNum == 3)
                    {
                        teamName = reverseTeamSides["CT"].teamName;
                    }
                    else if (player.TeamNum == 2)
                    {
                        teamName = reverseTeamSides["TERRORIST"].teamName;
                    }

                    stats["TeamName"] = teamName;

                    playerStatsDictionary.Add(steamid64, stats);

                    // Populate PlayerStats instance
                    // Todo: Implement stats which are marked as 0 for now
                    PlayerStats playerStatsInstance = new()
                    {
                        Kills = playerStats.Kills,
                        Deaths = playerStats.Deaths,
                        Assists = playerStats.Assists,
                        FlashAssists = 0,
                        TeamKills = 0,
                        Suicides = 0,
                        Damage = playerStats.Damage,
                        UtilityDamage = playerStats.UtilityDamage,
                        EnemiesFlashed = playerStats.EnemiesFlashed,
                        FriendliesFlashed = 0,
                        KnifeKills = 0,
                        HeadshotKills = playerStats.HeadShotKills,
                        RoundsPlayed = roundsPlayed,
                        BombDefuses = bombStats.Defuses(steamid64),
                        BombPlants = bombStats.Plants(steamid64),
                        Kills1 = 0,
                        Kills2 = playerStats.Enemy2Ks,
                        Kills3 = playerStats.Enemy3Ks,
                        Kills4 = playerStats.Enemy4Ks,
                        Kills5 = playerStats.Enemy5Ks,
                        OneV1s = playerStats.I1v1Wins,
                        OneV2s = playerStats.I1v2Wins,
                        OneV3s = 0,
                        OneV4s = 0,
                        OneV5s = 0,
                        FirstKillsT = 0,
                        FirstKillsCT = 0,
                        FirstDeathsT = 0,
                        FirstDeathsCT = 0,
                        TradeKills = 0,
                        Kast = 0,
                        Score = player.Score,
                        Mvps = player.MVPs,
                    };

                    StatsPlayer statsPlayer = new()
                    {
                        SteamId = steamid64.ToString(),
                        Name = player.PlayerName,
                        Stats = playerStatsInstance
                    };

                    int ctTeamNum = reverseTeamSides["CT"] == arenaproTeam1 ? 1 : 2;
                    int tTeamNum = reverseTeamSides["TERRORIST"] == arenaproTeam1 ? 1 : 2;

                    if (player.TeamNum == 3)
                    {
                        if (ctTeamNum == 1) playerStatsListTeam1.Add(statsPlayer);
                        if (ctTeamNum == 2) playerStatsListTeam2.Add(statsPlayer);
                    }
                    else if (player.TeamNum == 2)
                    {
                        if (tTeamNum == 1) playerStatsListTeam1.Add(statsPlayer);
                        if (tTeamNum == 2) playerStatsListTeam2.Add(statsPlayer);
                    }
                }
            }
            catch (Exception e)
            {
                Log($"[GetPlayerStatsDict FATAL] An error occurred: {e.Message}");
            }

            return (playerStatsDictionary, playerStatsListTeam1, playerStatsListTeam2);
        }

        static string RemoveSpecialCharacters(string input)
        {
            Regex regex = new("[^\\p{L}0-9 _-]");
            return regex.Replace(input, "");
        }

        private void Log(string message)
        {
            Console.WriteLine("[ArenaPro] " + message);
        }

        private void AutoStart()
        {
            Log($"[AutoStart] autoStartMode: {autoStartMode}");
            // Deathmatch, casual and other modes are not for matches: without a loaded match the server is left as the
            // game mode set it up (no warmup or .ready, bots are not kicked). Loading a match switches the mode itself.
            if (!isMatchSetup && !IsMatchGameMode())
            {
                StartFreePlay();
                return;
            }
            if (autoStartMode == 0)
            {
                StartSleepMode();
            }
            if (autoStartMode == 1)
            {
                readyAvailable = true;
                isPractice = false;
                StartWarmup();
            }
            if (autoStartMode == 2)
            {
                StartPracticeMode();
            }
        }

        // Competitive (game_type 0, game_mode 1) or Wingman (0, 2): the modes ArenaPro runs matches in
        public bool IsMatchGameMode()
        {
            int mode = GetGameMode();
            return GetGameType() == 0 && (mode == 1 || mode == 2);
        }

        public int GetGameMode()
        {
            var convar = ConVar<int>.Find("game_mode");
            if (convar != null)
            {
                return convar.Value;
            }
            return -1;
        }

        public int GetGameType()
        {
            var convar = ConVar<int>.Find("game_type");
            if (convar != null)
            {
                return convar.Value;
            }
            return -1;
        }

        public void SetCorrectGameMode()
        {
            ConVar<int>.Find("game_mode")!.Value = matchConfig.Wingman ? 2 : 1;
            ConVar<int>.Find("game_type")!.Value = 0; // Classic GameType
        }

        public bool IsMapReloadRequiredForGameMode(bool wingman)
        {
            int expectedMode = wingman ? 2 : 1;
            if (GetGameMode() != expectedMode || GetGameType() != 0)
            {
                return true;
            }
            return false;
        }

        public bool IsWingmanMode()
        {
            if (GetGameMode() == 2 && GetGameType() == 0) return true;
            return false;
        }

        // Kicks every human player (not bots or GOTV), e.g. once the series is over and the server is about to shut down
        public void KickAllPlayers()
        {
            foreach (var player in Utilities.GetPlayers())
            {
                if (!player.IsValid || player.IsBot || player.IsHLTV || !player.UserId.HasValue) continue;
                Server.ExecuteCommand($"kickid {(ushort)player.UserId} \"The match is over\"");
            }
        }

        public void KickPlayer(CCSPlayerController player)
        {
            if (player.UserId.HasValue)
            {
                Server.ExecuteCommand($"kickid {(ushort)player.UserId}");
            }
        }

        public bool IsPlayerValid(CCSPlayerController? player)
        {
            return (
                player != null &&
                player.IsValid &&
                player.PlayerPawn.IsValid &&
                player.PlayerPawn.Value != null
            );
        }

        public static Color GetPlayerTeammateColor(CCSPlayerController playerController)
        {
            return playerController.CompTeammateColor switch
            {
                1 => Color.FromArgb(50, 255, 0),
                2 => Color.FromArgb(255, 255, 0),
                3 => Color.FromArgb(255, 132, 0),
                4 => Color.FromArgb(255, 0, 255),
                0 => Color.FromArgb(0, 187, 255),
                _ => Color.Red,
            };
        }

        public static string? GetConvarValueFromCFGFile(string filePath, string convarName)
        {
            var fileContent = File.ReadAllText(filePath);

            string pattern = @$"^{convarName}\s+(.+)$";

            Regex regex = new(pattern, RegexOptions.Multiline);

            Match match = regex.Match(fileContent);
            string? value = match.Success ? match.Groups[1].Value : null;
            return value;
        }

        public async Task UploadFileAsync(string? filePath, string fileUploadURL, string headerKey, string headerValue, long matchId, int mapNumber, int roundNumber)
        {
            if (filePath == null || fileUploadURL == "")
            {
                Log($"[UploadFileAsync] Not able to upload the file, either filePath or fileUploadURL is not set. filePath: {filePath} fileUploadURL: {ArenaProSecurity.RedactUrl(fileUploadURL)}");
                return;
            }

            try
            {
                // Demos can be large and uploads slow: the default 100s timeout was too short.
                using var httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
                Log($"[UploadFileAsync] Going to upload the file on {ArenaProSecurity.RedactUrl(fileUploadURL)}. Complete path: {filePath}");

                if (!File.Exists(filePath))
                {
                    Log($"[UploadFileAsync ERROR] File not found: {filePath}");
                    return;
                }

                // Streamed from disk instead of read into memory (which also failed for files over 2 GB).
                using FileStream fileStream = File.OpenRead(filePath);
                using StreamContent content = new(fileStream);
                content.Headers.Add("Content-Type", "application/octet-stream");

                content.Headers.Add("ArenaPro-FileName", Path.GetFileName(filePath));
                content.Headers.Add("ArenaPro-MatchId", matchId.ToString());
                content.Headers.Add("ArenaPro-MapNumber", mapNumber.ToString());
                content.Headers.Add("ArenaPro-RoundNumber", roundNumber.ToString());

                // For Get5 Panel
                content.Headers.Add("Get5-FileName", Path.GetFileName(filePath));
                content.Headers.Add("Get5-MatchId", matchId.ToString());
                content.Headers.Add("Get5-MapNumber", mapNumber.ToString());
                content.Headers.Add("Get5-RoundNumber", roundNumber.ToString());


                if (!string.IsNullOrEmpty(headerKey) && !string.IsNullOrEmpty(headerValue))
                {
                    httpClient.DefaultRequestHeaders.Add(headerKey, headerValue);
                }

                HttpResponseMessage response = await httpClient.PostAsync(fileUploadURL, content);

                if (response.IsSuccessStatusCode)
                {
                    Log($"[UploadFileAsync] File upload successful for matchId: {matchId} mapNumber: {mapNumber} fileName: {Path.GetFileName(filePath)}.");
                }
                else
                {
                    Log($"[UploadFileAsync ERROR] Failed to upload file. Status code: {response.StatusCode} Response: {await response.Content.ReadAsStringAsync()}");
                }
            }
            catch (Exception e)
            {
                Log($"[UploadFileAsync FATAL] An error occurred: {e.Message}");
            }
        }

        public bool HandlePlayerWhitelist(CCSPlayerController player, string steamId)
        {
            string whitelistfileName = "ArenaPro/whitelist.cfg";
            string whitelistPath = Path.Join(Server.GameDirectory + "/csgo/cfg", whitelistfileName);
            string? directoryPath = Path.GetDirectoryName(whitelistPath);
            if (directoryPath != null)
            {
                if (!Directory.Exists(directoryPath))
                {
                    Directory.CreateDirectory(directoryPath);
                }
            }
            if (!File.Exists(whitelistPath)) File.WriteAllLines(whitelistPath, new[] { "Steamid1", "Steamid2" });

            var whiteList = File.ReadAllLines(whitelistPath);

            if (isWhitelistRequired == true)
            {
                if (!whiteList.Contains(steamId.ToString()))
                {
                    Log($"[EventPlayerConnectFull] KICKING PLAYER STEAMID: {steamId}, Name: {player.PlayerName} (Not whitelisted!)");
                    PrintToAllChat($"Kicking player {player.PlayerName} - Not whitelisted.");
                    KickPlayer(player);
                    return true;
                }
            }

            return false;
        }

        // team is the player's team in the loaded match (GetPlayerTeam). A player who is not in the match (CsTeam.None) is moved
        // to spectator: SwitchTeam(None) can crash the server.
        public void SwitchPlayerTeam(CCSPlayerController player, CsTeam team)
        {
            if (team == CsTeam.None) team = CsTeam.Spectator;
            if (player.Team == team) return;

            Server.NextFrame(() =>
            {
                // The player may have left, or moved again, by the next frame.
                if (player == null || !player.IsValid || player.Connected != PlayerConnectedState.Connected || player.Team == team) return;
                if (team == CsTeam.Spectator)
                {
                    // ChangeTeam on a live player strips its weapons inline, where other plugins' weapon hooks can crash the
                    // server; a dead player has nothing to strip.
                    CCSPlayerPawn? pawn = player.PlayerPawn.Value;
                    if (pawn != null && pawn.IsValid && player.PawnIsAlive)
                    {
                        pawn.CommitSuicide(false, true);
                        Server.NextFrame(() =>
                        {
                            if (player != null && player.IsValid && player.Connected == PlayerConnectedState.Connected) player.ChangeTeam(team);
                        });
                        return;
                    }
                    player.ChangeTeam(team);
                }
                else
                {
                    // Initial join must follow the game's jointeam path to finish team selection and create a playing pawn.
                    if (player.Team == CsTeam.None || player.Team == CsTeam.Spectator)
                        player.ChangeTeam(team);
                    else
                        player.SwitchTeam(team);
                    var gameRules = GetGameRules();
                    if (gameRules.WarmupPeriod)
                    {
                        player.Respawn();
                    }
                }
            });
        }

        public void SetPlayerInvisible(CCSPlayerController player, bool setWeaponsInvisible)
        {
            if (!IsPlayerValid(player)) return;
            var playerPawnValue = player.PlayerPawn.Value;

            if (playerPawnValue != null && playerPawnValue.IsValid)
            {
                playerPawnValue.Render = Color.FromArgb(0, 0, 0, 0);
                Utilities.SetStateChanged(playerPawnValue, "CBaseModelEntity", "m_clrRender");
            }

            if (!setWeaponsInvisible) return;

            var activeWeapon = playerPawnValue!.WeaponServices?.ActiveWeapon.Value;
            if (activeWeapon != null && activeWeapon.IsValid)
            {
                activeWeapon.Render = Color.FromArgb(0, 0, 0, 0);
                activeWeapon.ShadowStrength = 0.0f;
                Utilities.SetStateChanged(activeWeapon, "CBaseModelEntity", "m_clrRender");
            }

            var myWeapons = playerPawnValue.WeaponServices?.MyWeapons;
            if (myWeapons != null)
            {
                foreach (var gun in myWeapons)
                {
                    var weapon = gun.Value;
                    if (weapon != null)
                    {
                        weapon.Render = Color.FromArgb(0, 0, 0, 0);
                        weapon.ShadowStrength = 0.0f;
                        Utilities.SetStateChanged(weapon, "CBaseModelEntity", "m_clrRender");
                    }
                }
            }
        }

        public void SetPlayerVisible(CCSPlayerController player)
        {
            if (!IsPlayerValid(player)) return;

            var playerPawnValue = player.PlayerPawn.Value;
            if (playerPawnValue == null)
                return;

            playerPawnValue.Render = Color.FromArgb(255, 255, 255, 255);
            Utilities.SetStateChanged(playerPawnValue, "CBaseModelEntity", "m_clrRender");
        }

        public void DropWeaponByDesignerName(CCSPlayerController player, string weaponName)
        {
            if (!IsPlayerValid(player) || player.PlayerPawn.Value!.WeaponServices is null) return;
            var matchedWeapon = player.PlayerPawn.Value!.WeaponServices!.MyWeapons
                .Where(weapon => weapon.Value!.DesignerName == weaponName).FirstOrDefault();

            if (matchedWeapon != null && matchedWeapon.IsValid)
            {
                player.PlayerPawn.Value.WeaponServices.ActiveWeapon.Raw = matchedWeapon.Raw;
                player.DropActiveWeapon();
            }
        }

        public void RandomizeSpawns()
        {
            List<CCSPlayerController> players = Utilities.GetPlayers();

            Dictionary<byte, List<Position>> teamSpawns = new()
            {
                { (byte)CsTeam.CounterTerrorist, spawnsData[(byte)CsTeam.CounterTerrorist].Select(position => new Position(position)).ToList() },
                { (byte)CsTeam.Terrorist, spawnsData[(byte)CsTeam.Terrorist].Select(position => new Position(position)).ToList() }
            };

            Random random = new();

            foreach (var player in players)
            {
                if (!IsPlayerValid(player)) continue;
                
                if (teamSpawns[player.TeamNum].Count == 0) break;

                int randomIndex = random.Next(teamSpawns[player.TeamNum].Count);
                Position spawnPosition = teamSpawns[player.TeamNum][randomIndex];
                teamSpawns[player.TeamNum].RemoveAt(randomIndex);

                spawnPosition.Teleport(player);
            }
        }
    }
}
