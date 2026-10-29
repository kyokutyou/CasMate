using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallPathHintsTests
{
    private static DirectFirewallGrant Grant() => new(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), "0123456789abcdef01234567",
        @"C:\Apps\CasMate.exe", "192.168.1.7", "tcp", 3001, Guid.NewGuid().ToString(), "Ethernet", "Private");
    private static string PathFor(DirectFirewallGrant grant) => $"MSFT_NetFirewallRule.CreationClassName=\"MSFT|FW|FirewallRule|{DirectFirewall.RuleName(grant)}\",PolicyRuleName=\"\",SystemCreationClassName=\"\",SystemName=\"\"";

    [Fact] public void RoundTripRequiresTheEntireOwnershipScopeAndConfirmedRemovalPrunesTheHint()
    {
        var directory = Path.Combine(Path.GetTempPath(), "casmate-rule-path-test-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "paths.json"); var grant = Grant();
        try
        {
            var hints = DirectFirewallPathHints.Load(file); Assert.Null(hints.For(grant));
            hints.Remember(grant, PathFor(grant)); Assert.True(hints.Save(file, [grant]));
            hints = DirectFirewallPathHints.Load(file); Assert.Equal(PathFor(grant), hints.For(grant));
            foreach (var changed in new[] { grant with { Nonce = "1123456789abcdef01234567" }, grant with { Program = @"C:\Other.exe" },
                grant with { Address = "192.168.1.8" }, grant with { Port = 3002 }, grant with { InterfaceName = "Other" }, grant with { Profile = "Public" } })
                Assert.Null(hints.For(changed));
            Assert.True(hints.Save(file, [])); Assert.Null(DirectFirewallPathHints.Load(file).For(grant));
        }
        finally { File.Delete(file); Directory.Delete(directory); }
    }

    [Fact] public void UnknownClassesAndForeignKeysCannotBeSavedAsALookupLocation()
    {
        var hints = new DirectFirewallPathHints(); var grant = Grant();
        foreach (var path in new[] { "Win32_Process.Handle=\"1\"", PathFor(Grant()), PathFor(grant) + ",Extra=\"x\"" })
        { hints.Remember(grant, path); Assert.Null(hints.For(grant)); }
    }

    [Fact] public void BrokenHintsFallBackAndAnOptionalWriteFailureDoesNotClaimOwnership()
    {
        var file = Path.GetTempFileName(); var grant = Grant();
        try
        {
            File.WriteAllText(file, "{broken"); Assert.Null(DirectFirewallPathHints.Load(file).For(grant));
            var hints = new DirectFirewallPathHints(); hints.Remember(grant, PathFor(grant));
            Assert.False(hints.Save(Path.Combine(file, "impossible.json"), [grant]));
        }
        finally { File.Delete(file); }
    }

    [Fact] public void OversizedHintCollectionFallsBackInsteadOfLoadingAnUnboundedLedger()
    {
        var file = Path.GetTempFileName(); var grant = Grant();
        try
        {
            File.WriteAllText(file, System.Text.Json.JsonSerializer.Serialize(
                Enumerable.Repeat(new DirectFirewallPathHints.Entry(grant, PathFor(grant)), 4097), DirectFirewallService.Json));
            Assert.Null(DirectFirewallPathHints.Load(file).For(grant));
        }
        finally { File.Delete(file); }
    }
}
