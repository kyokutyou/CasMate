using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class CimDirectFirewallTests
{
    private static DirectFirewallRule Rule() => new("CasMate-Direct-pc-rule", "CasMate Direct nonce", @"C:\Apps\CasMate.exe", 6,
        ["4433"], ["192.168.1.7"], ["Any"], ["イーサネット 2"], 2, 2, 1, false);

    [Fact]
    public void UnchangedSnapshotUsesArrayValuesAndWindowsCaseInsensitivity()
    {
        var proof = Rule();
        var reread = Rule() with
        {
            InstanceId = proof.InstanceId.ToUpperInvariant(), Program = proof.Program.ToUpperInvariant(),
            RemoteAddresses = ["ANY"]
        };
        CimDirectFirewall.RequireUnchanged(proof, reread);
    }

    [Theory]
    [InlineData("id")]
    [InlineData("description")]
    [InlineData("program")]
    [InlineData("protocol")]
    [InlineData("local-port")]
    [InlineData("extra-port")]
    [InlineData("local-address")]
    [InlineData("extra-address")]
    [InlineData("remote-address")]
    [InlineData("interface")]
    [InlineData("profile")]
    [InlineData("action")]
    [InlineData("direction")]
    [InlineData("enabled")]
    public void RuleSubstitutionBetweenOwnershipReadAndMutationIsRejected(string field)
    {
        var proof = Rule();
        var current = field switch
        {
            "id" => proof with { InstanceId = "another-rule" },
            "description" => proof with { Description = "CasMate Direct different-nonce" },
            "program" => proof with { Program = @"C:\Apps\Another.exe" },
            "protocol" => proof with { Protocol = 17 },
            "local-port" => proof with { LocalPorts = ["Any"] },
            "extra-port" => proof with { LocalPorts = ["4433", "4434"] },
            "local-address" => proof with { LocalAddresses = ["Any"] },
            "extra-address" => proof with { LocalAddresses = ["192.168.1.7", "192.168.1.8"] },
            "remote-address" => proof with { RemoteAddresses = ["LocalSubnet"] },
            "interface" => proof with { Interfaces = ["Wi-Fi"] },
            "profile" => proof with { Profile = 0 },
            "action" => proof with { Action = 4 },
            "direction" => proof with { Direction = 2 },
            "enabled" => proof with { Enabled = true },
            _ => throw new InvalidOperationException()
        };
        var error = Assert.Throws<DirectFirewallException>(() => CimDirectFirewall.RequireUnchanged(proof, current));
        Assert.Equal("ownership", error.Code);
    }

    [Theory]
    [InlineData(null, 256)]
    [InlineData("", 256)]
    [InlineData("Any", 256)]
    [InlineData("TCP", 6)]
    [InlineData("tcp", 6)]
    [InlineData("6", 6)]
    [InlineData("UDP", 17)]
    [InlineData("17", 17)]
    [InlineData("ICMPv4", 1)]
    [InlineData("ICMPv6", 58)]
    [InlineData("47", 47)]
    public void RawProviderProtocolsPreserveMeaning(string? raw, int expected) =>
        Assert.Equal(expected, CimDirectFirewall.Protocol(raw));

    [Theory]
    [InlineData("unknown")]
    [InlineData("-1")]
    [InlineData("256")]
    public void UnknownProtocolsFailInsteadOfBecomingWildcard(string raw) =>
        Assert.Throws<DirectFirewallException>(() => CimDirectFirewall.Protocol(raw));

    [Fact]
    public void RawNullOrEmptyFilterArraysMeanAnyButMalformedFiltersFail()
    {
        Assert.Equal(["Any"], CimDirectFirewall.AnyStrings(null));
        Assert.Equal(["Any"], CimDirectFirewall.AnyStrings(Array.Empty<string>()));
        Assert.Equal(["4433", "4434-4436"], CimDirectFirewall.AnyStrings(new[] { "4433", "4434-4436" }));
        Assert.Throws<DirectFirewallException>(() => CimDirectFirewall.AnyStrings("4433"));
        Assert.Throws<DirectFirewallException>(() => CimDirectFirewall.AnyStrings(new object?[] { null }));
        Assert.Throws<DirectFirewallException>(() => CimDirectFirewall.AnyStrings(new[] { 4433 }));
    }

    [Fact]
    public void BlockProgramWithEnvironmentVariableMatchesConcreteExecutable()
    {
        var variable = "CASMATE_FIREWALL_TEST_" + Guid.NewGuid().ToString("N");
        try
        {
            Environment.SetEnvironmentVariable(variable, @"C:\Apps");
            Assert.True(CimDirectFirewall.BlockingProgramMatches($"%{variable}%\\CasMate.exe", @"c:\apps\casmate.exe"));
            Assert.True(CimDirectFirewall.BlockingProgramMatches("Any", @"C:\Apps\CasMate.exe"));
            Assert.False(CimDirectFirewall.BlockingProgramMatches($"%{variable}%\\Another.exe", @"C:\Apps\CasMate.exe"));
        }
        finally { Environment.SetEnvironmentVariable(variable, null); }
    }
}
