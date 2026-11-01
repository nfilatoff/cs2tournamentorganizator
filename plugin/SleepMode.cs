using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;


namespace ArenaPro
{

    public partial class ArenaPro
    {
        public const string sleepCfgPath = "ArenaPro/sleep.cfg";

        public void StartSleepMode()
        {
            if (matchStarted) return;
            isSleep = true;
            isPractice = false;
            isDryRun = false;
            isWarmup = false;
            readyAvailable = false;
            matchStarted = false;
            isSideSelectionPhase = false;
            isMatchLive = false;

            var absolutePath = Path.Join(Server.GameDirectory + "/csgo/cfg", sleepCfgPath);

            if (File.Exists(Path.Join(Server.GameDirectory + "/csgo/cfg", sleepCfgPath)))
            {
                Log($"Starting Sleep Mode! Executing Sleep CFG from {sleepCfgPath}");
                Server.ExecuteCommand($"exec {sleepCfgPath}");
            }
            else
            {
                Log($"Starting Sleep Mode! Sleep CFG not found in {absolutePath}, using default CFG!");
                ExecUnpracCommands();
                Server.ExecuteCommand("""exec gamemode_competitive.cfg;""");
            }
            ExecOverrideCfg(sleepCfgPath);
            Log($"[StartSleepMode] ArenaPro deactivated!");
        }

        // Free play (deathmatch, casual...): like sleep mode, ArenaPro stays out of the way, but no cfg is executed so the
        // game mode's own settings (respawns, bots) stay as they are. An admin can still start practice or match mode.
        public void StartFreePlay()
        {
            if (matchStarted) return;
            unreadyPlayerMessageTimer?.Kill();
            unreadyPlayerMessageTimer = null;
            isSleep = true;
            isPractice = false;
            isDryRun = false;
            isWarmup = false;
            readyAvailable = false;
            isSideSelectionPhase = false;
            isMatchLive = false;
            Log($"[StartFreePlay] game_type {GetGameType()}, game_mode {GetGameMode()}: no match mode, ArenaPro stays inactive");
        }

        [ConsoleCommand("css_sleep", "Starts sleep mode")]
        public void OnSleepCommand(CCSPlayerController? player, CommandInfo? command)
        {
            if (!IsPlayerAdmin(player, "css_sleep", "@css/map", "@custom/prac"))
            {
                SendPlayerNotAdminMessage(player);
                return;
            }

            if (matchStarted)
            {
                // ReplyToUserCommand(player, "Sleep Mode cannot be started when a match has been started!");
                ReplyToUserCommand(player, Localizer["arenapro.sleep.sleepwhenmatchstared"]);
                return;
            }
            StartSleepMode();
        }

    }
}
