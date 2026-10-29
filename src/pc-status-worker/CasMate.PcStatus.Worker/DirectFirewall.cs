using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace CasMate.PcStatus.Worker;

internal sealed record DirectFirewallGrant(string Id, string PcId, string Nonce, string Program, string Address,
    string Protocol, int Port, string InterfaceId, string InterfaceName, string Profile);

internal sealed record DirectFirewallRule(string InstanceId, string Description, string Program, int Protocol,
    string[] LocalPorts, string[] LocalAddresses, string[] RemoteAddresses, string[] Interfaces,
    uint Profile, int Action, int Direction, bool Enabled);

internal interface IDirectFirewallBackend
{
    // null means a completed query proved absence; provider failures must throw.
    DirectFirewallRule? ReadPersistent(string id);
    DirectFirewallRule? ReadActive(string id);
    void CheckAdapter(DirectFirewallGrant grant);
    void CheckPolicyAndBlocks(DirectFirewallGrant grant);
    void Create(DirectFirewallGrant grant);
    void Enable(string id);
    void Remove(string id);
}

internal sealed class DirectFirewallException(string code, Exception? inner = null) : Exception(code, inner)
{
    public string Code { get; } = code;
}

internal sealed class DirectFirewall(IDirectFirewallBackend backend)
{
    internal const int Inbound = 1, Allow = 2, Block = 4, AnyProtocol = 256;

    public bool TryReadOnly(DirectFirewallGrant grant, string action, Func<bool> live) => Guard(() =>
    {
        Validate(grant, action);
        var id = RuleName(grant);
        var persistent = backend.ReadPersistent(id);
        RequireOwnership(grant, persistent);
        if (action == "remove") return persistent is null;

        RequireLive(live);
        backend.CheckAdapter(grant);
        backend.CheckPolicyAndBlocks(grant);
        var active = backend.ReadActive(id);
        RequireOwnership(grant, active);
        RequireLive(live);
        return persistent?.Enabled == true && active?.Enabled == true;
    });

    public void Apply(DirectFirewallGrant grant, string action, Func<bool> live) => Guard(() =>
    {
        Validate(grant, action);
        var id = RuleName(grant);
        if (action == "remove") { RemoveOwned(grant); return true; }
        var persistent = backend.ReadPersistent(id);
        RequireOwnership(grant, persistent);

        RequireLive(live);
        backend.CheckAdapter(grant);
        backend.CheckPolicyAndBlocks(grant);
        RequireOwnership(grant, backend.ReadActive(id));
        // Repeat the persistent read immediately before mutation, including after UAC.
        persistent = backend.ReadPersistent(id);
        RequireOwnership(grant, persistent);
        RequireLive(live);
        try
        {
            if (persistent is null) backend.Create(grant);
            else if (!persistent.Enabled) backend.Enable(id);

            RequireLive(live);
            var active = backend.ReadActive(id);
            if (!Matches(grant, active) || active?.Enabled != true) throw new DirectFirewallException("failed");
            RequireLive(live);
        }
        catch (Exception error)
        {
            // A provider can fail after creating/enabling a rule. Cancellation must
            // still close the rechecked owned rule even when its active query failed.
            if (error is DirectFirewallException { Code: "cancelled" } || !IsLive(live))
            {
                RemoveOwned(grant);
                throw new DirectFirewallException("cancelled");
            }
            throw;
        }
        return true;
    });

    private void RemoveOwned(DirectFirewallGrant grant)
    {
        var current = backend.ReadPersistent(RuleName(grant));
        if (current is null) return;
        RequireOwnership(grant, current);
        backend.Remove(current.InstanceId);
        var residual = backend.ReadPersistent(RuleName(grant));
        RequireOwnership(grant, residual);
        if (residual is not null) throw new DirectFirewallException("failed");
    }

    internal static string RuleName(DirectFirewallGrant grant) => $"CasMate-Direct-{grant.PcId}-{grant.Id}";
    internal static uint ProfileMask(string profile) => profile switch
    {
        "Domain" => 1, "Private" => 2, "Public" => 4, _ => throw new DirectFirewallException("failed")
    };
    internal static int ProtocolNumber(string protocol) => protocol switch
    {
        "tcp" => 6, "udp" => 17, _ => throw new DirectFirewallException("failed")
    };

    internal static bool Matches(DirectFirewallGrant grant, DirectFirewallRule? rule) => rule is not null &&
        Same(rule.InstanceId, RuleName(grant)) && Same(rule.Description, $"CasMate Direct {grant.Nonce}") &&
        Same(rule.Program, grant.Program) && rule.Protocol == ProtocolNumber(grant.Protocol) &&
        One(rule.LocalPorts, grant.Port.ToString(CultureInfo.InvariantCulture)) &&
        rule.LocalAddresses is [var local] && IPAddress.TryParse(local, out var actual) &&
        IPAddress.TryParse(grant.Address, out var wanted) && actual.Equals(wanted) &&
        One(rule.RemoteAddresses, "Any") && One(rule.Interfaces, grant.InterfaceName) &&
        rule.Profile == ProfileMask(grant.Profile) && rule.Action == Allow && rule.Direction == Inbound;

    internal static bool PortIncludes(IEnumerable<string> values, int port)
    {
        foreach (var value in values)
        {
            if (Same(value, "Any")) return true;
            if (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var exact) && exact == port) return true;
            var range = value.Split('-');
            if (range.Length == 2 && int.TryParse(range[0], NumberStyles.None, CultureInfo.InvariantCulture, out var start) &&
                int.TryParse(range[1], NumberStyles.None, CultureInfo.InvariantCulture, out var end) && start <= port && port <= end) return true;
        }
        return false;
    }

    internal static void Validate(DirectFirewallGrant grant, string action)
    {
        const string uuid = @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z";
        if (grant is null || action is not ("allow" or "remove") ||
            !Regex.IsMatch(grant.Id ?? "", uuid) || !Regex.IsMatch(grant.PcId ?? "", uuid) ||
            !Regex.IsMatch(grant.Nonce ?? "", @"^[a-f0-9]{24}\z") || grant.Protocol is not ("tcp" or "udp") ||
            grant.Profile is not ("Domain" or "Private" or "Public") || grant.Port is < 1024 or > 65535 ||
            string.IsNullOrEmpty(grant.Program) || grant.Program.Length > 32768 || grant.Program.Contains('\0') ||
            !Path.IsPathFullyQualified(grant.Program) || !Regex.IsMatch(grant.InterfaceId ?? "", @"^[a-zA-Z0-9{}-]{1,80}\z") ||
            !Guid.TryParse(grant.InterfaceId, out _) ||
            string.IsNullOrWhiteSpace(grant.InterfaceName) || grant.InterfaceName.Length > 256 ||
            grant.InterfaceName.Any(char.IsControl) || Same(grant.InterfaceName, "Any") ||
            grant.InterfaceName.IndexOfAny(['*', '?']) >= 0 || !AllowedAddress(grant.Address)) throw new DirectFirewallException("failed");
    }

    internal static bool AllowedAddress(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 45 || !IPAddress.TryParse(value, out var address)) return false;
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            // IPAddress accepts abbreviated, hexadecimal and padded IPv4; the app does not.
            if (!Same(address.ToString(), value)) return false;
            var octets = address.GetAddressBytes(); var a = octets[0]; var b = octets[1]; var c = octets[2];
            return a > 0 && a < 224 && a != 127 && !(a == 100 && b is >= 64 and <= 127) &&
                !(a == 169 && b == 254) && !(a == 192 && b == 0 && c is 0 or 2) &&
                !(a == 192 && b == 88 && c == 99) && !(a == 198 && (b is 18 or 19 || b == 51 && c == 100)) &&
                !(a == 203 && b == 0 && c == 113);
        }
        // Match the app's public IPv6 range and exclude transition/embedded forms.
        if (address.AddressFamily != AddressFamily.InterNetworkV6 || !Regex.IsMatch(value, @"^[23][0-9a-f]{3}:[0-9a-f:]+\z") ||
            value.Contains('.') || value.Contains('%')) return false;
        var bytes = address.GetAddressBytes();
        return !(bytes[0] == 0x20 && bytes[1] == 0x02) &&
            !(bytes[0] == 0x20 && bytes[1] == 0x01 &&
                (bytes[2] == 0 && bytes[3] == 0 || bytes[2] == 0x0d && bytes[3] == 0xb8));
    }

    private static void RequireOwnership(DirectFirewallGrant grant, DirectFirewallRule? rule)
    {
        if (rule is not null && !Matches(grant, rule)) throw new DirectFirewallException("ownership");
    }
    private static void RequireLive(Func<bool> live) { if (!IsLive(live)) throw new DirectFirewallException("cancelled"); }
    private static bool IsLive(Func<bool> live) { try { return live(); } catch { return false; } }
    private static bool One(string[] values, string wanted) => values is [var value] && Same(value, wanted);
    private static bool Same(string? first, string? second) => string.Equals(first, second, StringComparison.OrdinalIgnoreCase);
    private static T Guard<T>(Func<T> action)
    {
        try { return action(); }
        catch (DirectFirewallException) { throw; }
        catch (Exception error) { throw new DirectFirewallException("failed", error); }
    }
}
