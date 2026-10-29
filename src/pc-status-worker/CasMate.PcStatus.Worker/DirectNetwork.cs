using System.Collections;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;

internal record DirectAddress(string Family, string Address);
internal record DirectNic(string Id, string Name, string Description, bool Up, bool Excluded, int Index, DirectAddress[] Addresses);
internal record DirectRoute(int Index, int Family, string NextHop, ulong Metric);
internal record DirectProfile(int Index, int Category);
internal record DirectAdapter(string Id, string Name, string Description, string Profile, int Index,
    DirectAddress[] Addresses, string? Gateway4, string? Gateway6, bool Preferred);

internal static class DirectNetwork
{
    // The same local CIM providers used by NetTCPIP/NetConnection, without a shell.
    public static DirectAdapter[] Read(bool lan = false)
    {
        object? locator = null, services = null;
        try
        {
            locator = Activator.CreateInstance(Type.GetTypeFromProgID("WbemScripting.SWbemLocator", true)!);
            services = ((dynamic)locator!).ConnectServer(".", "root\\StandardCimv2");
            object security = ((dynamic)services).Security_;
            try { ((dynamic)security).ImpersonationLevel = 3; }
            finally { Release(security); }
            var routes = Query<DirectRoute?>(services, "SELECT * FROM MSFT_NetRoute", row =>
                Convert.ToInt32(Value(row, "State")) == 0 && Convert.ToString(Value(row, "DestinationPrefix")) is "0.0.0.0/0" or "::/0"
                    ? new DirectRoute(Convert.ToInt32(Value(row, "InterfaceIndex")), Convert.ToInt32(Value(row, "AddressFamily")), Convert.ToString(Value(row, "NextHop")) ?? "",
                        Convert.ToUInt64(Value(row, "RouteMetric")) + Convert.ToUInt64(Value(row, "InterfaceMetric"))) : null).OfType<DirectRoute>().ToArray();
            var profiles = Query(services, "SELECT * FROM MSFT_NetConnectionProfile",
                row => new DirectProfile(Convert.ToInt32(Value(row, "InterfaceIndex")), Convert.ToInt32(Value(row, "NetworkCategory"))));
            var nics = new List<DirectNic>();
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                try
                {
                    if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                        !lan && (nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel || nic.Description.Contains("Tailscale", StringComparison.OrdinalIgnoreCase))) continue;
                    var properties = nic.GetIPProperties();
                    var index = nic.Supports(NetworkInterfaceComponent.IPv4) ? properties.GetIPv4Properties().Index : properties.GetIPv6Properties().Index;
                    var addresses = properties.UnicastAddresses.Where(address =>
                        address.DuplicateAddressDetectionState == DuplicateAddressDetectionState.Preferred && address.AddressPreferredLifetime > 0 &&
                        address.AddressValidLifetime > 0 && !address.IsTransient && address.Address.AddressFamily is AddressFamily.InterNetwork or AddressFamily.InterNetworkV6)
                        .Select(address => new DirectAddress(address.Address.AddressFamily == AddressFamily.InterNetwork ? "ipv4" : "ipv6", address.Address.ToString())).ToArray();
                    nics.Add(new(nic.Id, nic.Name, nic.Description, true, false, index, addresses));
                }
                catch { /* One unavailable NIC must not hide other eligible connections. */ }
            }
            return Select(nics, routes, profiles, lan);
        }
        finally { Release(services); Release(locator); }
    }

    internal static DirectAdapter[] Select(IEnumerable<DirectNic> nics, IEnumerable<DirectRoute> routes, IEnumerable<DirectProfile> profiles, bool lan = false)
    {
        var ordered = routes.Where(route => route.Family is 2 or 23 && route.NextHop is not "" and not "0.0.0.0" and not "::")
            .OrderBy(route => route.Metric).ToArray();
        var result = new List<DirectAdapter>();
        foreach (var nic in nics)
        {
            if (!nic.Up || nic.Excluded || nic.Addresses.Length == 0) continue;
            var selected = ordered.Where(route => route.Index == nic.Index).ToArray();
            var category = profiles.FirstOrDefault(profile => profile.Index == nic.Index)?.Category;
            var profileName = category switch { 0 => "Public", 1 => "Private", 2 => "Domain", _ => null };
            if (!lan && (selected.Length == 0 || profileName is null)) continue;
            profileName ??= "Public";
            var gateway4 = selected.FirstOrDefault(route => route.Family == 2)?.NextHop;
            var gateway6 = selected.FirstOrDefault(route => route.Family == 23)?.NextHop;
            if (gateway6?.StartsWith("fe80:", StringComparison.OrdinalIgnoreCase) == true && !gateway6.Contains('%')) gateway6 += $"%{nic.Index}";
            result.Add(new(nic.Id, nic.Name, nic.Description, profileName, nic.Index, nic.Addresses, gateway4, gateway6, ordered.FirstOrDefault()?.Index == nic.Index));
        }
        return result.ToArray();
    }

    private static List<T> Query<T>(object services, string query, Func<dynamic, T> read)
    {
        object? rows = null; IEnumerator? iterator = null;
        try
        {
            rows = ((dynamic)services).ExecQuery(query, "WQL", 0);
            iterator = ((IEnumerable)rows!).GetEnumerator();
            var result = new List<T>();
            while (iterator.MoveNext())
            {
                var row = iterator.Current;
                try { result.Add(read(row)); }
                finally { Release(row); }
            }
            return result;
        }
        finally { Release(iterator); Release(rows); }
    }
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
    private static object Value(object row, string name)
    {
        object? properties = null, property = null;
        try
        {
            properties = ((dynamic)row).Properties_;
            property = ((dynamic)properties).Item(name, 0);
            return ((dynamic)property).Value ?? throw new InvalidOperationException("Missing network property");
        }
        finally { Release(property); Release(properties); }
    }
}
