using System.Security.Cryptography;
using System.Text;

namespace ArenaPro
{
    public enum AdminAuthResult
    {
        NotRequired, // no code is set on this server: admins do not need to authorize
        Ok,
        Wrong,
        Locked,      // too many wrong codes in a row, wait before trying again
    }

    // Admin login on the game server (arenapro_admin_auth_code): an ArenaPro admin may only use admin commands after typing
    // the code in the client console. An authorization is valid for the code it was made with, so a new code (e.g. the next
    // match's) requires a new login. Wrong codes lock the player out for a while.
    // This file must not depend on CounterStrikeSharp so that it can be unit tested (see tests/).
    public class AdminAuth
    {
        public const int MaxAttempts = 5;
        public const int LockSeconds = 300;

        private readonly Dictionary<ulong, string> authorizedWith = new();
        private readonly Dictionary<ulong, (int failures, long lockedUntil)> attempts = new();

        public string Code { get; set; } = "";

        public bool Required => !string.IsNullOrWhiteSpace(Code);

        public bool IsAuthorized(ulong steamId) =>
            !Required || (authorizedWith.TryGetValue(steamId, out string? code) && code == Code);

        // Seconds left until the player may try again (0 if not locked)
        public long LockedFor(ulong steamId, long nowSeconds) =>
            attempts.TryGetValue(steamId, out var a) && a.lockedUntil > nowSeconds ? a.lockedUntil - nowSeconds : 0;

        public AdminAuthResult TryAuthorize(ulong steamId, string? code, long nowSeconds)
        {
            if (!Required) return AdminAuthResult.NotRequired;
            if (LockedFor(steamId, nowSeconds) > 0) return AdminAuthResult.Locked;
            if (Matches(code?.Trim() ?? "", Code.Trim()))
            {
                authorizedWith[steamId] = Code;
                attempts.Remove(steamId);
                return AdminAuthResult.Ok;
            }
            int failures = (attempts.TryGetValue(steamId, out var a) ? a.failures : 0) + 1;
            attempts[steamId] = failures >= MaxAttempts ? (0, nowSeconds + LockSeconds) : (failures, 0);
            return failures >= MaxAttempts ? AdminAuthResult.Locked : AdminAuthResult.Wrong;
        }

        // The player left the server: the next visit needs the code again
        public void Forget(ulong steamId) => authorizedWith.Remove(steamId);

        private static bool Matches(string given, string expected) =>
            CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(expected));
    }
}
