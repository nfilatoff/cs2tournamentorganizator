using ArenaPro;

namespace ArenaPro.Tests;

public class AdminAuthTests
{
    private const ulong Admin = 76561198000000001;

    [Fact]
    public void WithoutCodeEveryAdminIsAuthorized()
    {
        var auth = new AdminAuth();
        Assert.True(auth.IsAuthorized(Admin));
        Assert.Equal(AdminAuthResult.NotRequired, auth.TryAuthorize(Admin, "x", 0));
    }

    [Fact]
    public void RightCodeUnlocksUntilTheCodeChanges()
    {
        var auth = new AdminAuth { Code = "AB12CD" };
        Assert.False(auth.IsAuthorized(Admin));
        Assert.Equal(AdminAuthResult.Ok, auth.TryAuthorize(Admin, " AB12CD ", 0));
        Assert.True(auth.IsAuthorized(Admin));
        auth.Code = "ZZ99ZZ";
        Assert.False(auth.IsAuthorized(Admin));
    }

    [Fact]
    public void LeavingTheServerForgetsTheAuthorization()
    {
        var auth = new AdminAuth { Code = "AB12CD" };
        auth.TryAuthorize(Admin, "AB12CD", 0);
        auth.Forget(Admin);
        Assert.False(auth.IsAuthorized(Admin));
    }

    [Fact]
    public void WrongCodesLockThePlayerOut()
    {
        var auth = new AdminAuth { Code = "AB12CD" };
        for (int i = 1; i < AdminAuth.MaxAttempts; i++) Assert.Equal(AdminAuthResult.Wrong, auth.TryAuthorize(Admin, "nope", 10));
        Assert.Equal(AdminAuthResult.Locked, auth.TryAuthorize(Admin, "nope", 10));
        // Even the right code is refused while locked
        Assert.Equal(AdminAuthResult.Locked, auth.TryAuthorize(Admin, "AB12CD", 20));
        Assert.Equal(AdminAuth.LockSeconds - 10, auth.LockedFor(Admin, 20));
        Assert.Equal(AdminAuthResult.Ok, auth.TryAuthorize(Admin, "AB12CD", 10 + AdminAuth.LockSeconds));
    }
}
