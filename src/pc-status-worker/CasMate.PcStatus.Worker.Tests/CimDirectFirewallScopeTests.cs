using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class CimDirectFirewallScopeTests
{
    private static DirectFirewallGrant Grant() => new(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), "0123456789abcdef01234567",
        @"C:\Test\CasMate.exe", "192.168.0.105", "tcp", 3001, Guid.NewGuid().ToString(), "primary", "Private");

    [Theory]
    [InlineData("192.168.10.105", "primary", false)]
    [InlineData("Any", "secondary", false)]
    [InlineData("192.168.0.0/24", "primary", true)]
    [InlineData("192.168.10.0/24", "primary", false)]
    [InlineData("192.168.0.0/255.255.255.0", "primary", true)]
    [InlineData("192.168.10.0/255.255.255.0", "primary", false)]
    [InlineData("192.168.0.100-192.168.0.110", "Any", true)]
    [InlineData("192.168.10.100-192.168.10.110", "Any", false)]
    [InlineData("192.168.0.105", "primary", true)]
    [InlineData("Any", "Any", true)]
    [InlineData("Any", "pri*", true)]
    [InlineData("LocalSubnet", "primary", true)]
    public void ChecksTheActualLocalScopeBeforeRejectingPreparation(string address, string alias, bool blocked)
    {
        var provider = new Provider(address, alias);
        using var backend = new CimDirectFirewall(provider);
        if (blocked) Assert.Equal("policy", Assert.Throws<DirectFirewallException>(() => backend.CheckPolicyAndBlocks(Grant())).Code);
        else backend.CheckPolicyAndBlocks(Grant());
        Assert.True(provider.AddressReads > 0);
    }

    [Theory]
    [InlineData("2001:4860::/32", "2001:4860:1::9", true)]
    [InlineData("2606:4700::/32", "2001:4860:1::9", false)]
    [InlineData("2001:4860::1-2001:4860::f", "2001:4860::9", true)]
    [InlineData("192.168.0.105", "2001:4860::9", false)]
    [InlineData("malformed", "192.168.0.105", true)]
    public void HandlesIpv6AndConservativelyKeepsUnknownAddressScopes(string scope, string address, bool matches) =>
        Assert.Equal(matches, CimDirectFirewall.BlockingAddressMatches([scope], address));

    public sealed class Provider(string localAddress, string alias)
    {
        public int AddressReads;
        public object[] ExecQuery(string query, string language, int flags, object context)
        {
            if (query.Contains("MSFT_NetFirewallProfile")) return [new Row(new() { ["AllowLocalFirewallRules"] = 1u, ["AllowInboundRules"] = 1u })];
            if (query.Contains("WHERE Direction=1")) return [new Row(new() { ["Profiles"] = 2u })];
            if (query.Contains("ResultClass=MSFT_NetApplicationFilter")) return [new Row(new() { ["AppPath"] = @"C:\Test\CasMate.exe" })];
            if (query.Contains("ResultClass=MSFT_NetProtocolPortFilter")) return [new Row(new() { ["Protocol"] = "TCP", ["LocalPort"] = new[] { "3001" } })];
            if (query.Contains("ResultClass=MSFT_NetAddressFilter")) { AddressReads++; return [new Row(new() { ["LocalAddress"] = new[] { localAddress } })]; }
            if (query.Contains("ResultClass=MSFT_NetInterfaceFilter")) return [new Row(new() { ["InterfaceAlias"] = new[] { alias } })];
            throw new InvalidOperationException("Unexpected provider query");
        }
    }
    public sealed class Row(Dictionary<string, object> values)
    {
        public Properties Properties_ => new(values);
        public ObjectPath Path_ => new();
    }
    public sealed class ObjectPath { public string RelPath => "MSFT_NetFirewallRule.InstanceID='test-block'"; }
    public sealed class Properties(Dictionary<string, object> values) { public Property Item(string name, int flags) => new(values[name]); }
    public sealed class Property(object value) { public object Value => value; }
}
