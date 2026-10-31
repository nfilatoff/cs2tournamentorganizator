using System.Text.Json.Serialization;

namespace ArenaPro;
public class ArenaProEvent
{
    public ArenaProEvent(string eventName)
    {
        EventName = eventName;
    }

    [JsonPropertyName("event")]
    public string EventName { get; }
}

public class ArenaProMatchEvent : ArenaProEvent
{
    [JsonPropertyName("matchid")]
    public required long MatchId { get; init; }

    protected ArenaProMatchEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProMatchTeamEvent : ArenaProMatchEvent
{
    [JsonPropertyName("team")]
    public required string Team { get; init; }

    protected ArenaProMatchTeamEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProMapEvent : ArenaProMatchEvent
{
    [JsonPropertyName("map_number")]
    public required int MapNumber { get; init; }

    protected ArenaProMapEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProMapTeamEvent : ArenaProMapEvent
{
    [JsonPropertyName("team_int")]
    public required int TeamNumber { get; init; }

    protected ArenaProMapTeamEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProRoundEvent : ArenaProMapEvent
{
    [JsonPropertyName("round_number")]
    public required int RoundNumber { get; init; }

    protected ArenaProRoundEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProTimedRoundEvent : ArenaProRoundEvent
{
    [JsonPropertyName("round_time")]
    public required int RoundTime { get; init; }

    protected ArenaProTimedRoundEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProPlayerRoundEvent : ArenaProRoundEvent
{

    [JsonPropertyName("player")]
    public required ArenaProPlayer Player { get; init; }

    protected ArenaProPlayerRoundEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProPlayerTimedRoundEvent : ArenaProTimedRoundEvent
{
    [JsonPropertyName("player")]
    public required ArenaProPlayer Player { get; init; }

    protected ArenaProPlayerTimedRoundEvent(string eventName) : base(eventName)
    {
    }
}

// Get5Player: a player in the live events.
public class ArenaProPlayer
{
    // SteamID64, or BOT-<user_id> for bots.
    [JsonPropertyName("steamid")]
    public required string SteamId { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("user_id")]
    public required int UserId { get; init; }

    // "ct", "t", "spec", or null.
    [JsonPropertyName("side")]
    public string? Side { get; init; }

    [JsonPropertyName("is_bot")]
    public required bool IsBot { get; init; }
}

// Get5Weapon: the game's weapon name and SourceMod's weapon id (0 when it has none).
public class ArenaProWeapon
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("id")]
    public required int Id { get; init; }
}

// Get5AssisterObject
public class ArenaProAssist
{
    [JsonPropertyName("player")]
    public required ArenaProPlayer Player { get; init; }

    [JsonPropertyName("friendly_fire")]
    public required bool FriendlyFire { get; init; }

    [JsonPropertyName("flash_assist")]
    public required bool FlashAssist { get; init; }
}

// Get5PlayerDeathEvent. player is the victim; attacker and assist are null when there is none.
public class ArenaProPlayerDeathEvent : ArenaProPlayerTimedRoundEvent
{
    [JsonPropertyName("weapon")]
    public required ArenaProWeapon Weapon { get; init; }

    [JsonPropertyName("bomb")]
    public required bool Bomb { get; init; }

    [JsonPropertyName("headshot")]
    public required bool Headshot { get; init; }

    [JsonPropertyName("thru_smoke")]
    public required bool ThruSmoke { get; init; }

    // Number of objects (players or walls) the bullet went through.
    [JsonPropertyName("penetrated")]
    public required int Penetrated { get; init; }

    [JsonPropertyName("attacker_blind")]
    public required bool AttackerBlind { get; init; }

    [JsonPropertyName("no_scope")]
    public required bool NoScope { get; init; }

    [JsonPropertyName("suicide")]
    public required bool Suicide { get; init; }

    [JsonPropertyName("friendly_fire")]
    public required bool FriendlyFire { get; init; }

    [JsonPropertyName("attacker")]
    public ArenaProPlayer? Attacker { get; init; }

    [JsonPropertyName("assist")]
    public ArenaProAssist? Assist { get; init; }

    public ArenaProPlayerDeathEvent() : base("player_death")
    {
    }
}

// Get5PlayerBombEvent: bomb_planted / bomb_defused. site is "a", "b" or null.
public class ArenaProBombEvent : ArenaProPlayerTimedRoundEvent
{
    [JsonPropertyName("site")]
    public string? Site { get; init; }

    public ArenaProBombEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProBombDefusedEvent : ArenaProBombEvent
{
    // Milliseconds left on the bomb timer.
    [JsonPropertyName("bomb_time_remaining")]
    public required int BombTimeRemaining { get; init; }

    public ArenaProBombDefusedEvent() : base("bomb_defused")
    {
    }
}

// round_start: when freeze time begins.
public class ArenaProRoundStartedEvent : ArenaProRoundEvent
{
    public ArenaProRoundStartedEvent() : base("round_start")
    {
    }
}

// backup_loaded: round_number is the round restored to.
public class ArenaProBackupRestoredEvent : ArenaProRoundEvent
{
    [JsonPropertyName("filename")]
    public required string FileName { get; init; }

    public ArenaProBackupRestoredEvent() : base("backup_loaded")
    {
    }
}

// Get5PlayerDisconnectedEvent
public class ArenaProPlayerDisconnectedEvent : ArenaProMatchEvent
{
    [JsonPropertyName("player")]
    public required ArenaProPlayer Player { get; init; }

    public ArenaProPlayerDisconnectedEvent() : base("player_disconnect")
    {
    }
}

public class ArenaProSeriesStartedEvent : ArenaProMatchEvent
{
    [JsonPropertyName("team1")]
    public required ArenaProTeamWrapper Team1 { get; init; }

    [JsonPropertyName("team2")]
    public required ArenaProTeamWrapper Team2 { get; init; }

    [JsonPropertyName("num_maps")]
    public required int NumberOfMaps { get; init; }

    public ArenaProSeriesStartedEvent() : base("series_start")
    {
    }
}

// game_paused / game_unpaused, as in Get5.
public class ArenaProPauseEvent : ArenaProMapEvent
{
    [JsonPropertyName("team")]
    public required string Team { get; init; }

    [JsonPropertyName("pause_type")]
    public required string PauseType { get; init; }

    public ArenaProPauseEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProSeriesResultEvent : ArenaProMatchEvent
{
    [JsonPropertyName("time_until_restore")]
    public required int TimeUntilRestore { get; init; }

    [JsonPropertyName("winner")]
    public required Winner Winner { get; init; }

    [JsonPropertyName("team1_series_score")]
    public required int Team1SeriesScore { get; init; }

    [JsonPropertyName("team2_series_score")]
    public required int Team2SeriesScore { get; init; }

    public ArenaProSeriesResultEvent() : base("series_end")
    {
    }
}

public class GoingLiveEvent : ArenaProMapEvent
{
    public GoingLiveEvent() : base("going_live")
    {
    }
}

public class ArenaProRoundEndedEvent : ArenaProTimedRoundEvent
{

    [JsonPropertyName("reason")]
    public required int Reason { get; init; }

    [JsonPropertyName("winner")]
    public required Winner Winner { get; init; }

    [JsonPropertyName("team1")]
    public required ArenaProStatsTeam StatsTeam1 { get; init; }

    [JsonPropertyName("team2")]
    public required ArenaProStatsTeam StatsTeam2 { get; init; }

    public ArenaProRoundEndedEvent() : base("round_end")
    {
    }
}

public class MapResultEvent : ArenaProMapEvent
{
    [JsonPropertyName("winner")]
    public required Winner Winner { get; init; }

    [JsonPropertyName("team1")]
    public required ArenaProStatsTeam StatsTeam1 { get; init; }

    [JsonPropertyName("team2")]
    public required ArenaProStatsTeam StatsTeam2 { get; init; }

    public MapResultEvent() : base("map_result")
    {
    }
}

public class ArenaProMapSelectionEvent : ArenaProMatchTeamEvent
{
    [JsonPropertyName("map_name")]
    public required string MapName { get; init; }

    protected ArenaProMapSelectionEvent(string eventName) : base(eventName)
    {
    }
}

public class ArenaProMapPickedEvent : ArenaProMapSelectionEvent
{
    [JsonPropertyName("map_number")]
    public required int MapNumber { get; init; }

    public ArenaProMapPickedEvent() : base("map_picked")
    {
    }
}

public class ArenaProMapVetoedEvent : ArenaProMapSelectionEvent
{
    public ArenaProMapVetoedEvent() : base("map_vetoed")
    {
    }
}

public class ArenaProSidePickedEvent : ArenaProMapSelectionEvent
{
    [JsonPropertyName("map_number")]
    public required int MapNumber { get; init; }

    [JsonPropertyName("side")]
    public required string Side { get; init; }

    public ArenaProSidePickedEvent() : base("side_picked")
    {
    }
}

public class ArenaProDemoUploadedEvent : ArenaProMatchEvent
{
    [JsonPropertyName("map_number")]
    public required int MapNumber { get; init; }

    [JsonPropertyName("filename")]
    public required string FileName { get; init; }

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    public ArenaProDemoUploadedEvent() : base("demo_upload_ended")
    {
    }
}