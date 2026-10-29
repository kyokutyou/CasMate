using Xunit;
namespace CasMate.PcStatus.Worker.Tests;

public class DirectNetworkTests
{
    private static DirectNic Nic(int index, bool up = true, bool excluded = false) => new($"nic-{index}", "イーサネット 2", "USB Ethernet", up, excluded,
        index, [new("ipv4", "192.168.1.9"), new("ipv6", "2001:4860:1::9")]);

    [Fact] public void KeepsRouteMetricsProfilesAndIpv6GatewayScope()
    {
        var adapters = DirectNetwork.Select([Nic(1), Nic(2)], [new(1, 2, "192.168.1.1", 100), new(1, 23, "fe80::1", 90), new(2, 2, "192.168.2.1", 20)],
            [new(1, 1), new(2, 2)]);
        Assert.Equal("イーサネット 2", adapters[0].Name); Assert.Equal("Private", adapters[0].Profile);
        Assert.Equal("fe80::1%1", adapters[0].Gateway6); Assert.False(adapters[0].Preferred);
        Assert.Equal("Domain", adapters[1].Profile); Assert.True(adapters[1].Preferred);
    }
    [Fact] public void ExcludesDownTunnelTailscaleAndMissingProfileOrRoute()
    {
        var adapters = DirectNetwork.Select([Nic(1, up: false), Nic(2, excluded: true), Nic(3), Nic(4), Nic(5), Nic(6)],
            [new(1, 2, "192.168.1.1", 10), new(2, 2, "192.168.1.1", 10), new(3, 2, "192.168.1.1", 10), new(5, 2, "0.0.0.0", 10), new(6, 2, "192.168.1.1", 10)],
            [new(1, 0), new(2, 1), new(4, 1), new(5, 1), new(6, 99)]);
        Assert.Empty(adapters);
    }
    [Fact] public void ReflectsDisconnectAndProfileChangesWithoutCachedNicData()
    {
        var route = new DirectRoute(1, 2, "192.168.1.1", 10);
        Assert.Equal("Public", DirectNetwork.Select([Nic(1)], [route], [new(1, 0)])[0].Profile);
        Assert.Equal("Private", DirectNetwork.Select([Nic(1)], [route], [new(1, 1)])[0].Profile);
        Assert.Empty(DirectNetwork.Select([Nic(1, up: false)], [route], [new(1, 1)]));
    }
    [Fact] public void LanIncludesAdaptersWithoutGatewayOrProfileButDirectDoesNot()
    {
        Assert.Empty(DirectNetwork.Select([Nic(1)], [], []));
        var lan = DirectNetwork.Select([Nic(1), Nic(2, up: false)], [], [], lan: true);
        Assert.Single(lan); Assert.Equal("nic-1", lan[0].Id); Assert.Null(lan[0].Gateway4);
        Assert.False(lan[0].Preferred);
    }
    [Fact] public void WindowsCimReadCompletesWithoutLaunchingShell()
    {
        if (!OperatingSystem.IsWindows()) return;
        var rows = DirectNetwork.Read();
        Assert.All(rows, row => { Assert.NotEmpty(row.Id); Assert.NotEmpty(row.Addresses); Assert.True(row.Index > 0); });
    }
}
