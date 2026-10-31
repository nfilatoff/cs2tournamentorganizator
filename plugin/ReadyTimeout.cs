using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Utils;

namespace ArenaPro
{
    // Get5's time to start (get5_time_to_start / get5_time_to_start_veto): in a loaded match, teams have a number of seconds to
    // ready up. When the time runs out, a team that is not ready forfeits the series, or the series ends in a tie when neither
    // team is ready. Every ready-up phase (map selection, and the warmup of each map) gets the full time.
    public partial class ArenaPro
    {
        // Seconds teams have to ready up for live/knife, and for map selection. 0 = no limit.
        public int timeToStart = 0;
        public int timeToStartVeto = 0;

        // How teams get ready in a loaded match: 0 = players type .ready, 1 = join mode (a team is ready once
        // min_players_to_ready of its players have joined; the match starts after arenapro_join_start_delay seconds),
        // 2 = captain mode (as join mode, but each team's captain also types .ready once the team is complete; when the time
        // to start runs out, the team with more joined players wins instead of a tie, see ReadyTimeLogic.ForfeitWinnerByPlayers).
        public int readyMode = 0;
        public int joinStartDelay = 10;
        // Seconds left of the join mode start countdown, null while it does not run.
        private int? joinStartSecondsLeft = null;

        public bool IsJoinReadyMode() => isMatchSetup && (readyMode == 1 || readyMode == 2);
        public bool IsCaptainReadyMode() => isMatchSetup && readyMode == 2;

        // Captain mode: whether the captain of "team1" / "team2" has typed .ready in this warmup.
        public Dictionary<string, bool> captainReady = new() { { "team1", false }, { "team2", false } };

        // Seconds of ready-up time used in the current phase (Get5: g_ReadyTimeWaitingUsed).
        private int readyTimeWaitingUsed = 0;
        private ReadyPhase lastReadyPhase = ReadyPhase.None;

        private enum ReadyPhase { None, MapSelection, Warmup }

        [ConsoleCommand("arenapro_time_to_start", "Time (in seconds) teams have to ready up for live/knife before forfeiting the match. 0 = unlimited. Default: 0")]
        [ConsoleCommand("get5_time_to_start", "Time (in seconds) teams have to ready up for live/knife before forfeiting the match. 0 = unlimited. Default: 0")]
        public void TimeToStartCommand(CCSPlayerController? player, CommandInfo command)
        {
            if (player != null) return;
            if (int.TryParse(GetSettingArgument(command), out int seconds) && seconds >= 0) timeToStart = seconds;
        }

        [ConsoleCommand("arenapro_time_to_start_veto", "Time (in seconds) teams have to ready up for map selection before forfeiting the match. 0 = unlimited. Default: 0")]
        [ConsoleCommand("get5_time_to_start_veto", "Time (in seconds) teams have to ready up for map selection before forfeiting the match. 0 = unlimited. Default: 0")]
        public void TimeToStartVetoCommand(CCSPlayerController? player, CommandInfo command)
        {
            if (player != null) return;
            if (int.TryParse(GetSettingArgument(command), out int seconds) && seconds >= 0) timeToStartVeto = seconds;
        }

        [ConsoleCommand("arenapro_ready_mode", "How teams get ready in a loaded match: 0 = players type .ready, 1 = a team is ready once min_players_to_ready of its players have joined, 2 = as 1, plus the captain types .ready. Default: 0")]
        public void ReadyModeCommand(CCSPlayerController? player, CommandInfo command)
        {
            if (player != null) return;
            if (int.TryParse(GetSettingArgument(command), out int mode) && mode >= 0 && mode <= 2) readyMode = mode;
        }

        // "team1" / "team2" for a CT/T side number, or null.
        private string? TeamKeyOfSide(int side)
        {
            if (side == GetTeamSideNumber("team1")) return "team1";
            if (side == GetTeamSideNumber("team2")) return "team2";
            return null;
        }

        // Captain mode: .ready / .unready from a player. The team's captain (team "captain" in the match config) readies the
        // team; while the captain is not on the server, any player of the team can.
        private void HandleCaptainReady(CCSPlayerController player, bool ready)
        {
            string? key = TeamKeyOfSide(player.TeamNum);
            if (key == null) return;
            Team team = key == "team1" ? arenaproTeam1 : arenaproTeam2;
            bool captainHere = team.captainSteamId != "" && playerData.Values.Any(p => p.IsValid && !p.IsBot
                && p.TeamNum == player.TeamNum && p.SteamID.ToString() == team.captainSteamId);
            if (captainHere && player.SteamID.ToString() != team.captainSteamId)
            {
                PrintToPlayerChat(player, Localizer["arenapro.ready.captainonly"]);
                return;
            }
            if (ready && !ReadyTimeLogic.IsTeamComplete(GetJoinedPlayerCount(player.TeamNum), GetTeamMinReady(player.TeamNum)))
            {
                PrintToPlayerChat(player, Localizer["arenapro.ready.captainwaitteam", GetJoinedPlayerCount(player.TeamNum), GetTeamMinReady(player.TeamNum)]);
                return;
            }
            if (captainReady[key] == ready) return;
            captainReady[key] = ready;
            PrintToAllChat(Localizer[ready ? "arenapro.ready.captainready" : "arenapro.ready.captainunready", team.teamName]);
        }


        [ConsoleCommand("arenapro_join_start_delay", "arenapro_ready_mode 1: seconds between all players having joined and the match starting. Default: 10")]
        public void JoinStartDelayCommand(CCSPlayerController? player, CommandInfo command)
        {
            if (player != null) return;
            if (int.TryParse(GetSettingArgument(command), out int seconds) && seconds >= 0) joinStartDelay = seconds;
        }

        // Join mode: roster players on that side (not coaches), or spectators.
        public int GetJoinedPlayerCount(int team)
        {
            return playerData.Values.Count(p => p.IsValid && !p.IsBot && p.TeamNum == team
                && !arenaproTeam1.coach.Contains(p) && !arenaproTeam2.coach.Contains(p));
        }

        // Join mode: starts the match once everyone has joined and the countdown has run. A player leaving stops it.
        private void HandleJoinStartCountdown()
        {
            bool everyoneJoined = IsTeamReady((int)CsTeam.CounterTerrorist, log: false) && IsTeamReady((int)CsTeam.Terrorist, log: false)
                && IsTeamReady((int)CsTeam.Spectator, log: false);
            var (secondsLeft, step) = ReadyTimeLogic.NextJoinCountdown(joinStartSecondsLeft, everyoneJoined, joinStartDelay);
            joinStartSecondsLeft = secondsLeft;
            switch (step)
            {
                case JoinCountdownStep.Started:
                    PrintToAllChat(Localizer["arenapro.ready.joinstartcountdown", secondsLeft!.Value]);
                    break;
                case JoinCountdownStep.Running:
                    if (ReadyTimeLogic.ShouldAnnounceJoinCountdown(secondsLeft!.Value)) PrintToAllChat(Localizer["arenapro.ready.joinstartin", secondsLeft.Value]);
                    break;
                case JoinCountdownStep.Stopped:
                    PrintToAllChat(Localizer["arenapro.ready.joinstartstopped"]);
                    break;
                case JoinCountdownStep.Finished:
                    Log("[HandleJoinStartCountdown] All players have joined, starting the match.");
                    CheckLiveRequired(fromJoinCountdown: true);
                    break;
            }
        }

        [ConsoleCommand("css_addreadytime", "Gives the teams more time to ready up. Usage: .addreadytime <seconds>")]
        [ConsoleCommand("arenapro_add_ready_time", "Gives the teams more time to ready up. Usage: arenapro_add_ready_time <seconds>")]
        [ConsoleCommand("get5_add_ready_time", "Gives the teams more time to ready up. Usage: get5_add_ready_time <seconds>")]
        public void OnAddReadyTimeCommand(CCSPlayerController? player, CommandInfo? command)
        {
            HandleAddReadyTimeCommand(player, command?.ArgCount > 1 ? command.ArgByIndex(1) : "");
        }

        public void HandleAddReadyTimeCommand(CCSPlayerController? player, string argument)
        {
            if (!IsPlayerAdmin(player, "css_addreadytime", "@css/map"))
            {
                SendPlayerNotAdminMessage(player);
                return;
            }
            ReadyPhase phase = GetReadyPhase();
            if (phase == ReadyPhase.None) return;
            if (!int.TryParse(argument, out int seconds) || seconds <= 0)
            {
                ReplyToUserCommand(player, Localizer["arenapro.cc.usage", ".addreadytime <seconds>"]);
                return;
            }
            int timeLimit = phase == ReadyPhase.MapSelection ? timeToStartVeto : timeToStart;
            if (timeLimit <= 0)
            {
                ReplyToUserCommand(player, Localizer["arenapro.ready.nolimit"]);
                return;
            }
            // As in Get5: the seconds are taken off the time used, which cannot go below 0 (so at most the full time is left).
            int usedBefore = readyTimeWaitingUsed;
            readyTimeWaitingUsed = Math.Max(0, readyTimeWaitingUsed - seconds);
            int added = usedBefore - readyTimeWaitingUsed;
            ReplyToUserCommand(player, Localizer["arenapro.ready.addreadytime", added, ReadyTimeLogic.FormatTime(timeLimit - readyTimeWaitingUsed)]);
        }

        private ReadyPhase GetReadyPhase()
        {
            if (!isMatchSetup || !readyAvailable || matchStarted || isPractice || isDryRun) return ReadyPhase.None;
            if (isPreVeto) return ReadyPhase.MapSelection;
            if (isWarmup && !isVeto) return ReadyPhase.Warmup;
            return ReadyPhase.None;
        }

        // Runs every second (Get5: Timer_CheckReady -> CheckReadyWaitingTimes).
        private void CheckReadyTime()
        {
            try
            {
                ReadyPhase phase = GetReadyPhase();
                if (phase != lastReadyPhase)
                {
                    // Each ready-up phase gets the full time (map selection and live are limited separately).
                    readyTimeWaitingUsed = 0;
                    joinStartSecondsLeft = null;
                    captainReady["team1"] = captainReady["team2"] = false;
                    lastReadyPhase = phase;
                }
                if (phase == ReadyPhase.None) return;
                if (mapChangePending)
                {
                    // As in Get5: no countdown while a map change is pending.
                    readyTimeWaitingUsed = 0;
                    joinStartSecondsLeft = null;
                    return;
                }
                if (IsJoinReadyMode())
                {
                    // Also for a pending backup restore: it starts once everyone has joined, like the match itself.
                    HandleJoinStartCountdown();
                    if (GetReadyPhase() == ReadyPhase.None) return; // The match has started.
                }
                if (isRoundRestorePending)
                {
                    // As in Get5: no ready-up time limit while a backup restore is pending.
                    readyTimeWaitingUsed = 0;
                    return;
                }

                readyTimeWaitingUsed++;
                int timeLimit = phase == ReadyPhase.MapSelection ? timeToStartVeto : timeToStart;
                bool team1Ready = IsTeamReady(GetTeamSideNumber("team1"), log: false);
                bool team2Ready = IsTeamReady(GetTeamSideNumber("team2"), log: false);

                ReadyTimeOutcome outcome = ReadyTimeLogic.Check(team1Ready, team2Ready, timeLimit, readyTimeWaitingUsed);
                if (outcome == ReadyTimeOutcome.Ready) return;

                if (outcome == ReadyTimeOutcome.Waiting)
                {
                    int timeLeft = timeLimit - readyTimeWaitingUsed;
                    // The chat only reminds now and then, so the remaining time is also shown every second in the center of the screen.
                    string hudText = Localizer["arenapro.ready.hudtimeleft", ReadyTimeLogic.FormatTime(timeLeft)];
                    foreach (var player in playerData.Values)
                    {
                        if (player.IsValid && !player.IsBot) player.PrintToCenter(hudText);
                    }
                    if (!ReadyTimeLogic.ShouldWarn(timeLeft)) return;
                    string formattedTimeLeft = ReadyTimeLogic.FormatTime(timeLeft);
                    if (IsCaptainReadyMode())
                    {
                        PrintToAllChat(Localizer["arenapro.ready.captainmodetimeleft", formattedTimeLeft]);
                    }
                    else if (!team1Ready && !team2Ready)
                    {
                        PrintToAllChat(Localizer["arenapro.ready.teamsmustbereadyortie", formattedTimeLeft]);
                    }
                    else
                    {
                        Team notReady = team1Ready ? arenaproTeam2 : arenaproTeam1;
                        PrintToAllChat(Localizer["arenapro.ready.teammustbereadyorforfeit", notReady.teamName, formattedTimeLeft]);
                    }
                    return;
                }

                // Time is up.
                int winner = ReadyTimeLogic.ForfeitWinner(team1Ready, team2Ready);
                if (IsCaptainReadyMode())
                {
                    int joined1 = GetJoinedPlayerCount(GetTeamSideNumber("team1"));
                    int joined2 = GetJoinedPlayerCount(GetTeamSideNumber("team2"));
                    winner = ReadyTimeLogic.ForfeitWinnerByPlayers(joined1, joined2, team1Ready, team2Ready, Random.Shared.Next(1, 3));
                    Log($"[CheckReadyTime] Captain mode: {joined1} vs {joined2} players joined, ready {team1Ready}/{team2Ready}, team{winner} wins.");
                    if (joined1 == joined2 && team1Ready == team2Ready) PrintToAllChat(Localizer["arenapro.ready.coinflip"]);
                }
                Team? winningTeam = winner == 1 ? arenaproTeam1 : winner == 2 ? arenaproTeam2 : null;
                if (winningTeam != null)
                {
                    Team forfeitingTeam = winningTeam == arenaproTeam1 ? arenaproTeam2 : arenaproTeam1;
                    PrintToAllChat(Localizer["arenapro.ready.teamforfeited", forfeitingTeam.teamName]);
                    Log($"[CheckReadyTime] {forfeitingTeam.teamName} did not ready up within {timeLimit}s and forfeits the series.");
                }
                else
                {
                    PrintToAllChat(Localizer["arenapro.ready.teamstiednotready", arenaproTeam1.teamName, arenaproTeam2.teamName]);
                    Log($"[CheckReadyTime] Neither team readied up within {timeLimit}s, the series ends in a tie.");
                }
                readyTimeWaitingUsed = 0;
                // Same end of series as get5_endmatch: a winner by forfeit, or no winner (series_end winner "none").
                ForceEndSeries(winningTeam);
            }
            catch (Exception e)
            {
                Log($"[CheckReadyTime FATAL] An error occurred: {e.Message}");
            }
        }
    }
}
