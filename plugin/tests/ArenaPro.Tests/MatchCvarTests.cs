using ArenaPro;

namespace ArenaPro.Tests;

public class MatchCvarTests
{
    // Stand-ins for the engine convar lookup and the plugin's FakeConVar names.
    private static readonly HashSet<string> EngineConVars = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp_friendlyfire", "hostname", "mp_maxrounds", "sv_password", "rcon_password",
    };
    private static readonly HashSet<string> FakeConVars = new(StringComparer.OrdinalIgnoreCase)
    {
        "arenapro_enable_damage_report", "arenapro_everyone_is_admin", "arenapro_hostname_format",
    };

    private static bool Allowed(string name, string value) =>
        ArenaProSecurity.IsAllowedMatchCvar(name, value, EngineConVars.Contains, FakeConVars, out _);

    [Theory]
    [InlineData("mp_friendlyfire", "0")]
    [InlineData("hostname", "ArenaPro: Astralis vs NaVi #27")]
    [InlineData("sv_password", "scrim123")]
    [InlineData("arenapro_remote_log_url", "https://panel.example.com/events?key=abc")]
    [InlineData("get5_remote_log_url", "https://panel.example.com/events")]
    [InlineData("arenapro_remote_log_header_value", "Bearer abc.def")]
    [InlineData("arenapro_enable_damage_report", "false")]
    [InlineData("arenapro_hostname_format", "{TEAM1} vs {TEAM2}")]
    [InlineData("arenapro_demo_path", "ArenaPro/")]
    [InlineData("arenapro_demo_path", "")]
    [InlineData("arenapro_demo_name_format", "{TIME}_{MATCH_ID}_{MAP}")]
    [InlineData("MP_FRIENDLYFIRE", "1")]
    public void AllowsSettings(string name, string value) => Assert.True(Allowed(name, value));

    [Theory]
    // Console commands that are not convars
    [InlineData("quit", "1")]
    [InlineData("exec", "evil.cfg")]
    [InlineData("changelevel", "de_dust2")]
    // Explicitly blocked
    [InlineData("rcon_password", "x")]
    [InlineData("arenapro_everyone_is_admin", "true")]
    // ArenaPro / Get5 action commands
    [InlineData("arenapro_loadmatch_url", "https://evil.example.com/m.json")]
    [InlineData("get5_loadmatch_url", "https://evil.example.com/m.json")]
    [InlineData("arenapro_loadbackup", "x.json")]
    [InlineData("get5_endmatch", "")]
    [InlineData("arenapro_addplayer", "76561198000000000 team1")]
    [InlineData("arenapro_some_future_action", "1")]
    // Names that are not a single identifier
    [InlineData("mp_friendlyfire 0; quit", "1")]
    [InlineData("mp_friendlyfire;quit", "1")]
    [InlineData("", "1")]
    [InlineData("say hi", "1")]
    public void RejectsNames(string name, string value) => Assert.False(Allowed(name, value));

    [Theory]
    [InlineData("0\"; quit; \"")]
    [InlineData("0; quit")]
    [InlineData("0\nquit")]
    [InlineData("0\rquit")]
    [InlineData("\"")]
    public void RejectsUnsafeValues(string value)
    {
        Assert.False(Allowed("mp_friendlyfire", value));
        Assert.False(Allowed("arenapro_remote_log_url", value));
    }

    [Theory]
    [InlineData("../../../cfg")]
    [InlineData("demos/../..")]
    [InlineData("/etc/")]
    [InlineData("\\\\server\\share")]
    [InlineData("C:/demos")]
    public void RejectsUnsafeDemoPaths(string value)
    {
        Assert.False(Allowed("arenapro_demo_path", value));
        Assert.False(Allowed("arenapro_demo_name_format", value));
    }

    [Fact]
    public void ReportsReason()
    {
        ArenaProSecurity.IsAllowedMatchCvar("quit", "1", EngineConVars.Contains, FakeConVars, out string reason);
        Assert.Equal("not a convar", reason);
    }

    [Fact]
    public void EveryAllowedSettingCommandIsAPluginSetting()
    {
        foreach (string name in ArenaProSecurity.MatchConfigSettingCommands)
        {
            Assert.True(name.StartsWith("arenapro_") || name.StartsWith("get5_"), name);
            Assert.DoesNotContain("_loadmatch", name);
            Assert.DoesNotContain("_loadbackup", name);
            Assert.DoesNotContain("endmatch", name);
        }
    }

    [Theory]
    [InlineData("ArenaPro Server", true)]
    [InlineData("EU #1; Scrims", true)]
    [InlineData("has \"quote\"", false)]
    [InlineData("line\nbreak", false)]
    public void QuotableValues(string value, bool expected) => Assert.Equal(expected, ArenaProSecurity.IsQuotableValue(value));
}
