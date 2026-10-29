using System.Collections;
using System.Globalization;
using System.Net;
using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;

// Use the same provider and policy stores as NetSecurity, without launching a shell.
// Its InstanceID is the stable rule ID; the COM firewall display name is not unique.
internal sealed class CimDirectFirewall : IDirectFirewallBackend, IDisposable
{
    private object? locator;
    private object? services;
    private sealed record RuleProof(DirectFirewallRule Rule, string Path);
    private readonly Dictionary<string, RuleProof> persistentProof = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> removedPaths = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<(string Id, string Store), string> knownPaths = new();
    private readonly Dictionary<string, string[]> initialPaths = new(StringComparer.OrdinalIgnoreCase);

    internal static bool IsStandardPath(string id, string path) => string.Equals(path,
        $"MSFT_NetFirewallRule.CreationClassName=\"MSFT|FW|FirewallRule|{id}\",PolicyRuleName=\"\",SystemCreationClassName=\"\",SystemName=\"\"", StringComparison.OrdinalIgnoreCase);
    internal void HintPersistentPath(string id, string path)
    {
        if (IsStandardPath(id, path)) knownPaths[(id, "PersistentStore")] = path;
    }
    internal string? PersistentPath(string id)
    {
        foreach (var store in new[] { "PersistentStore", "ActiveStore" })
            if (knownPaths.TryGetValue((id, store), out var path) && IsStandardPath(id, path)) return path;
        return null;
    }
    internal void InitialPaths(string id, string[] paths, string action = "allow")
    {
        if (action != "allow") return; // A rollback/removal must never consume a pre-create absence.
        if (paths.Any(path => !path.StartsWith("MSFT_NetFirewallRule.", StringComparison.OrdinalIgnoreCase))) throw new DirectFirewallException("failed");
        initialPaths[id] = paths;
    }

    // Only key discovery is shared. Each target independently reads its fresh full scope.
    internal Dictionary<string, string[]> DiscoverPaths(string[] ids)
    {
        object? context = null;
        try
        {
            context = Context("PersistentStore");
            var wanted = ids.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var rows = Query("SELECT * FROM MSFT_NetFirewallRule WHERE " + string.Join(" OR ", ids.Select(id => $"InstanceID='{Wql(id)}'")), context, row =>
            {
                var id = Text(row, "InstanceID");
                if (!wanted.Contains(id)) throw new DirectFirewallException("failed");
                return (Id: id, Path: RulePath(row));
            });
            return ids.ToDictionary(id => id, id => rows.Where(row => Same(row.Id, id)).Select(row => row.Path).ToArray(), StringComparer.OrdinalIgnoreCase);
        }
        finally { Release(context); }
    }

    internal CimDirectFirewall(object services) { this.services = services; }

    public CimDirectFirewall()
    {
        try
        {
            locator = NewCom("WbemScripting.SWbemLocator");
            services = ((dynamic)locator).ConnectServer(".", "root\\StandardCimv2");
            object? security = null;
            try { security = ((dynamic)services).Security_; ((dynamic)security).ImpersonationLevel = 3; }
            finally { Release(security); }
        }
        catch { Dispose(); throw; }
    }

    public DirectFirewallRule? ReadPersistent(string id)
    {
        // A failed or absent new query must invalidate any previous proof.
        persistentProof.Remove(id);
        var proof = removedPaths.Remove(id, out var removedPath) ? ReadRemoved(id, removedPath) : Read(id, "PersistentStore");
        if (proof is not null) persistentProof[id] = proof with { Rule = proof.Rule with
        {
            LocalPorts = [.. proof.Rule.LocalPorts], LocalAddresses = [.. proof.Rule.LocalAddresses],
            RemoteAddresses = [.. proof.Rule.RemoteAddresses], Interfaces = [.. proof.Rule.Interfaces]
        } };
        return proof?.Rule;
    }
    public DirectFirewallRule? ReadActive(string id) => Read(id, "ActiveStore")?.Rule;

    public void CheckAdapter(DirectFirewallGrant grant)
    {
        var expected = Guid.Parse(grant.InterfaceId);
        var address = IPAddress.Parse(grant.Address);
        var matches = DirectNetwork.Read().Where(adapter => Guid.TryParse(adapter.Id, out var id) && id == expected &&
            Same(adapter.Name, grant.InterfaceName) && Same(adapter.Profile, grant.Profile) &&
            adapter.Addresses.Any(candidate => IPAddress.TryParse(candidate.Address, out var actual) && actual.Equals(address))).ToArray();
        if (matches.Length != 1) throw new DirectFirewallException("adapter");
    }

    public void CheckPolicyAndBlocks(DirectFirewallGrant grant)
    {
        object? context = null;
        try
        {
            context = Context("ActiveStore");
            var profiles = Query($"SELECT * FROM MSFT_NetFirewallProfile WHERE Name='{Wql(grant.Profile)}'", context,
                row => (Local: Number(row, "AllowLocalFirewallRules"), Inbound: Number(row, "AllowInboundRules")));
            if (profiles.Count != 1 || profiles[0].Local == 0 || profiles[0].Inbound == 0)
                throw new DirectFirewallException("policy");

            var profile = DirectFirewall.ProfileMask(grant.Profile);
            Query("SELECT * FROM MSFT_NetFirewallRule WHERE Direction=1 AND Action=4 AND Enabled=1", context, row =>
            {
                var ruleProfile = Number(row, "Profiles");
                if (ruleProfile != 0 && (ruleProfile & profile) == 0) return false;
                var program = Filter(row, "Application", "MSFT_NetApplicationFilter", context,
                    filter => AnyString(Value(filter, "AppPath")));
                if (!BlockingProgramMatches(program, grant.Program)) return false;
                var port = Filter(row, "ProtocolPort", "MSFT_NetProtocolPortFilter", context,
                    filter => (Protocol: Protocol(Value(filter, "Protocol")), Ports: AnyStrings(Value(filter, "LocalPort"))));
                if (port.Protocol != DirectFirewall.AnyProtocol && port.Protocol != DirectFirewall.ProtocolNumber(grant.Protocol)) return false;
                if (!DirectFirewall.PortIncludes(port.Ports, grant.Port)) return false;
                var local = Filter(row, "Address", "MSFT_NetAddressFilter", context,
                    filter => AnyStrings(Value(filter, "LocalAddress")));
                if (!BlockingAddressMatches(local, grant.Address)) return false;
                var interfaces = Filter(row, "Interface", "MSFT_NetInterfaceFilter", context,
                    filter => AnyStrings(Value(filter, "InterfaceAlias")));
                if (!interfaces.Any(value => Same(value, "Any") || System.IO.Enumeration.FileSystemName.MatchesSimpleExpression(value, grant.InterfaceName, true))) return false;
                throw new DirectFirewallException("policy");
            });
        }
        finally { Release(context); }
    }

    public void Create(DirectFirewallGrant grant)
    {
        object? context = null, ruleClass = null, instance = null, path = null;
        try
        {
            context = Context("PersistentStore", ("Program", grant.Program), ("Protocol", grant.Protocol.ToUpperInvariant()),
                ("LocalPort", new[] { grant.Port.ToString(CultureInfo.InvariantCulture) }),
                ("LocalAddress", new[] { grant.Address }), ("RemoteAddress", new[] { "Any" }),
                ("InterfaceAlias", new[] { grant.InterfaceName }));
            ruleClass = ((dynamic)Services).Get("MSFT_NetFirewallRule", 0, context);
            instance = ((dynamic)ruleClass).SpawnInstance_(0);
            Set(instance, "InstanceID", DirectFirewall.RuleName(grant));
            Set(instance, "ElementName", "CasMate 直接接続");
            Set(instance, "Description", $"CasMate Direct {grant.Nonce}");
            Set(instance, "Enabled", (ushort)1);
            Set(instance, "Profiles", (ushort)DirectFirewall.ProfileMask(grant.Profile));
            Set(instance, "Direction", (ushort)DirectFirewall.Inbound);
            Set(instance, "Action", (ushort)DirectFirewall.Allow);
            // CreateOnly prevents an intervening rule from being overwritten.
            path = ((dynamic)instance).Put_(2, context);
            string relative = ((dynamic)path).RelPath;
            if (!relative.StartsWith("MSFT_NetFirewallRule.", StringComparison.OrdinalIgnoreCase)) throw new DirectFirewallException("failed");
            // The provider returned the created object's keys. ActiveStore must still be read fresh.
            knownPaths[(DirectFirewall.RuleName(grant), "ActiveStore")] = relative;
            knownPaths[(DirectFirewall.RuleName(grant), "PersistentStore")] = relative;
        }
        finally { Release(path); Release(instance); Release(ruleClass); Release(context); }
    }

    public void Enable(string id) => WithPersistent(id, (row, context) =>
    {
        object? result = null;
        try
        {
            result = ((dynamic)row).ExecMethod_("Enable", null, 0, context);
            if (Number(result!, "ReturnValue") != 0) throw new DirectFirewallException("failed");
        }
        finally { Release(result); }
    });

    public void Remove(string id)
    {
        removedPaths.Remove(id);
        var path = WithPersistent(id, (row, context) =>
        {
            // Delete the queried object with all provider keys, never a display name.
            ((dynamic)row).Delete_(0, context);
        });
        removedPaths[id] = path;
    }

    private RuleProof? ReadRemoved(string id, string path)
    {
        object? context = null, row = null;
        try
        {
            context = Context("PersistentStore");
            try { row = ((dynamic)Services).Get(path, 0, context); }
            catch (COMException error) when (error.HResult == unchecked((int)0x80041002)) { return null; } // WBEM_E_NOT_FOUND only.
            return new RuleProof(ReadRow(row, id, context), path);
        }
        finally { Release(row); Release(context); }
    }

    private RuleProof? Read(string id, string store)
    {
        object? context = null;
        try
        {
            context = Context(store);
            if (store == "PersistentStore" && initialPaths.Remove(id, out var initial))
            {
                if (initial.Length > 1) throw new DirectFirewallException("failed");
                if (initial.Length == 0) return null; // Completed same-request search, consumed exactly once.
                knownPaths[(id, store)] = initial[0];
            }
            if (knownPaths.TryGetValue((id, store), out var known))
            {
                object? current = null;
                try
                {
                    try { current = ((dynamic)Services).Get(known, 0, context); }
                    catch (COMException error) when (error.HResult == unchecked((int)0x80041002)) { }
                    if (current is not null)
                    {
                        var rule = ReadRow(current, id, context);
                        // Put_ may return an alias. Persist only the freshly resolved object's real keys.
                        var actualPath = RulePath(current); knownPaths[(id, store)] = actualPath;
                        return new RuleProof(rule, actualPath);
                    }
                    // A replacement may use different provider keys. Re-establish uniqueness.
                    knownPaths.Remove((id, store));
                }
                finally { Release(current); }
            }
            var rules = Query(ForId(id), context, row =>
            {
                var rule = ReadRow(row, id, context);
                return new RuleProof(rule, RulePath(row));
            });
            if (rules.Count > 1) throw new DirectFirewallException("failed");
            var proof = rules.SingleOrDefault();
            if (proof is not null) knownPaths[(id, store)] = proof.Path;
            return proof;
        }
        finally { Release(context); }
    }

    private static string RulePath(object row)
    {
        object? path = null;
        try
        {
            path = ((dynamic)row).Path_;
            string relative = ((dynamic)path).RelPath;
            if (!relative.StartsWith("MSFT_NetFirewallRule.", StringComparison.OrdinalIgnoreCase)) throw new DirectFirewallException("failed");
            return relative;
        }
        finally { Release(path); }
    }

    private DirectFirewallRule ReadRow(object row, string id, object context)
    {
        var actualId = Text(row, "InstanceID");
        if (!Same(actualId, id)) throw new DirectFirewallException("failed");
        var program = OwnedFilter(row, "Application", "MSFT_NetApplicationFilter", context,
            filter => AnyString(Value(filter, "AppPath")));
        var port = OwnedFilter(row, "ProtocolPort", "MSFT_NetProtocolPortFilter", context,
            filter => (Protocol: Protocol(Value(filter, "Protocol")), Ports: AnyStrings(Value(filter, "LocalPort"))));
        var addresses = OwnedFilter(row, "Address", "MSFT_NetAddressFilter", context,
            filter => (Local: AnyStrings(Value(filter, "LocalAddress")), Remote: AnyStrings(Value(filter, "RemoteAddress"))));
        var interfaces = OwnedFilter(row, "Interface", "MSFT_NetInterfaceFilter", context,
            filter => AnyStrings(Value(filter, "InterfaceAlias")));
        var enabled = Number(row, "Enabled");
        if (enabled is not (1 or 2)) throw new DirectFirewallException("failed");
        return new DirectFirewallRule(actualId, Text(row, "Description"), program, port.Protocol, port.Ports,
            addresses.Local, addresses.Remote, interfaces, Number(row, "Profiles"), checked((int)Number(row, "Action")),
            checked((int)Number(row, "Direction")), enabled == 1);
    }

    private string WithPersistent(string id, Action<object, object> change)
    {
        // Consume the proof so callers cannot reuse it after a mutation or a provider failure.
        if (!persistentProof.Remove(id, out var expected)) throw new DirectFirewallException("ownership");
        object? context = null, row = null;
        try
        {
            context = Context("PersistentStore");
            // Re-read the exact object found by the unique query; never repeat a broad enumeration.
            row = ((dynamic)Services).Get(expected.Path, 0, context);
            RequireUnchanged(expected.Rule, ReadRow(row, id, context));
            change(row, context);
            return expected.Path;
        }
        finally { Release(row); Release(context); }
    }

    private T OwnedFilter<T>(object rule, string associationSuffix, string resultClass, object context, Func<object, T> read)
    {
        var id = Text(rule, "InstanceID"); var creation = Text(rule, "CreationClassName");
        if (!id.StartsWith("CasMate-Direct-", StringComparison.Ordinal) || creation != "MSFT|FW|FirewallRule|" + id ||
            Text(rule, "PolicyRuleName") != "" || Text(rule, "SystemCreationClassName") != "" || Text(rule, "SystemName") != "")
            return Filter(rule, associationSuffix, resultClass, context, read);
        object? filter = null;
        try
        {
            // Standard WFAS filters share the rule's CreationClassName; PolicyRuleName maps to Name.
            // Exact Get avoids the provider's expensive association enumeration on every proof read.
            var key = creation.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);
            filter = ((dynamic)Services).Get($"{resultClass}.CreationClassName=\"{key}\",Name=\"\",SystemCreationClassName=\"\",SystemName=\"\"", 0, context);
            if (!Same(Text(filter, "InstanceID"), id) || Text(filter, "CreationClassName") != creation ||
                Text(filter, "Name") != "" || Text(filter, "SystemCreationClassName") != "" || Text(filter, "SystemName") != "")
                throw new DirectFirewallException("ownership");
            return read(filter);
        }
        finally { Release(filter); }
    }

    private T Filter<T>(object rule, string associationSuffix, string resultClass, object context, Func<object, T> read)
    {
        object? path = null;
        try
        {
            path = ((dynamic)rule).Path_;
            string relativePath = ((dynamic)path).RelPath;
            if (string.IsNullOrEmpty(relativePath)) throw new DirectFirewallException("failed");
            var values = Query($"ASSOCIATORS OF {{{relativePath}}} WHERE AssocClass=MSFT_NetFirewallRuleFilterBy{associationSuffix} " +
                $"ResultClass={resultClass} Role=GroupComponent ResultRole=PartComponent", context, read);
            if (values.Count != 1) throw new DirectFirewallException("failed");
            return values[0];
        }
        finally { Release(path); }
    }

    private List<T> Query<T>(string query, object context, Func<object, T> read)
    {
        object? rows = null; IEnumerator? iterator = null;
        try
        {
            rows = ((dynamic)Services).ExecQuery(query, "WQL", 0, context);
            iterator = ((IEnumerable)rows).GetEnumerator();
            var result = new List<T>();
            while (iterator.MoveNext())
            {
                var row = iterator.Current ?? throw new DirectFirewallException("failed");
                try { result.Add(read(row)); }
                finally { Release(row); }
            }
            return result;
        }
        finally { Release(iterator); Release(rows); }
    }

    private static object Context(string store, params (string Name, object Value)[] options)
    {
        var context = NewCom("WbemScripting.SWbemNamedValueSet");
        try
        {
            Add(context, "PolicyStore", store);
            foreach (var (name, value) in options) Add(context, name, value);
            return context;
        }
        catch { Release(context); throw; }
    }
    private static void Add(object context, string name, object value)
    {
        object? item = null;
        try { item = ((dynamic)context).Add(name, value, 0); }
        finally { Release(item); }
    }
    private static object? Value(object row, string name)
    {
        object? properties = null, property = null;
        try
        {
            properties = ((dynamic)row).Properties_;
            property = ((dynamic)properties).Item(name, 0);
            object? value = ((dynamic)property).Value;
            return value is DBNull ? null : value;
        }
        finally { Release(property); Release(properties); }
    }
    private static void Set(object row, string name, object value)
    {
        object? properties = null, property = null;
        try
        {
            properties = ((dynamic)row).Properties_;
            property = ((dynamic)properties).Item(name, 0);
            ((dynamic)property).Value = value;
        }
        finally { Release(property); Release(properties); }
    }
    private static uint Number(object row, string name) => Convert.ToUInt32(Value(row, name) ??
        throw new DirectFirewallException("failed"), CultureInfo.InvariantCulture);
    private static string Text(object row, string name) => Convert.ToString(Value(row, name), CultureInfo.InvariantCulture) ?? "";
    private static string AnyString(object? value) => string.IsNullOrEmpty(Convert.ToString(value, CultureInfo.InvariantCulture))
        ? "Any" : Convert.ToString(value, CultureInfo.InvariantCulture)!;
    internal static string[] AnyStrings(object? value)
    {
        if (value is null) return ["Any"];
        if (value is not Array array) throw new DirectFirewallException("failed");
        if (array.Length == 0) return ["Any"];
        return array.Cast<object?>().Select(item => item is string text && text.Length > 0 ? text :
            throw new DirectFirewallException("failed")).ToArray();
    }
    internal static int Protocol(object? value)
    {
        var protocol = AnyString(value);
        if (Same(protocol, "Any")) return DirectFirewall.AnyProtocol;
        if (Same(protocol, "TCP")) return 6;
        if (Same(protocol, "UDP")) return 17;
        if (Same(protocol, "ICMPv4")) return 1;
        if (Same(protocol, "ICMPv6")) return 58;
        if (int.TryParse(protocol, NumberStyles.None, CultureInfo.InvariantCulture, out var numeric) && numeric is >= 0 and <= 255)
            return numeric;
        throw new DirectFirewallException("failed");
    }
    internal static bool BlockingProgramMatches(string program, string wanted) => Same(program, "Any") ||
        Same(Environment.ExpandEnvironmentVariables(program), wanted);
    internal static bool BlockingAddressMatches(string[] values, string wanted)
    {
        var target = IPAddress.Parse(wanted); if (target.IsIPv4MappedToIPv6) target = target.MapToIPv4();
        return values.Any(value => AddressContains(value, target) != false);
    }
    // Unknown Windows address keywords remain potential matches. Only a proven
    // different local scope may exclude a block; remote addresses are unrestricted.
    private static bool? AddressContains(string value, IPAddress target)
    {
        if (Same(value, "Any") || value == "*") return true;
        if (IPAddress.TryParse(value, out var address))
        {
            if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
            return address.Equals(target);
        }
        var range = value.Split('-');
        if (range.Length == 2 && IPAddress.TryParse(range[0], out var first) && IPAddress.TryParse(range[1], out var last))
        {
            if (first.IsIPv4MappedToIPv6) first = first.MapToIPv4();
            if (last.IsIPv4MappedToIPv6) last = last.MapToIPv4();
            if (first.AddressFamily != last.AddressFamily) return null;
            if (target.AddressFamily != first.AddressFamily) return false;
            var bytes = target.GetAddressBytes(); var start = first.GetAddressBytes(); var end = last.GetAddressBytes();
            if (start.AsSpan().SequenceCompareTo(end) > 0) return null;
            return bytes.AsSpan().SequenceCompareTo(start) >= 0 && bytes.AsSpan().SequenceCompareTo(end) <= 0;
        }
        var network = value.Split('/');
        if (network.Length == 2 && IPAddress.TryParse(network[0], out var prefix))
        {
            var bytes = prefix.GetAddressBytes();
            if (!int.TryParse(network[1], out var bits))
            {
                if (!IPAddress.TryParse(network[1], out var subnetMask) || subnetMask.AddressFamily != prefix.AddressFamily) return null;
                bits = 0; var zeroSeen = false;
                foreach (var octet in subnetMask.GetAddressBytes()) for (var bit = 7; bit >= 0; bit--)
                {
                    if ((octet & (1 << bit)) == 0) zeroSeen = true;
                    else { if (zeroSeen) return null; bits++; }
                }
            }
            if (bits < 0 || bits > bytes.Length * 8) return null;
            if (prefix.IsIPv4MappedToIPv6) return null;
            if (prefix.AddressFamily != target.AddressFamily) return false;
            var actual = target.GetAddressBytes();
            for (var i = 0; i < bytes.Length && bits > 0; i++, bits -= 8)
            {
                var mask = (byte)(0xff << (8 - Math.Min(8, bits)));
                if ((bytes[i] & mask) != (actual[i] & mask)) return false;
            }
            return true;
        }
        return null;
    }
    internal static void RequireUnchanged(DirectFirewallRule expected, DirectFirewallRule current)
    {
        if (!Same(expected.InstanceId, current.InstanceId) || !Same(expected.Description, current.Description) ||
            !Same(expected.Program, current.Program) || expected.Protocol != current.Protocol ||
            !expected.LocalPorts.SequenceEqual(current.LocalPorts, StringComparer.OrdinalIgnoreCase) ||
            !expected.LocalAddresses.SequenceEqual(current.LocalAddresses, StringComparer.OrdinalIgnoreCase) ||
            !expected.RemoteAddresses.SequenceEqual(current.RemoteAddresses, StringComparer.OrdinalIgnoreCase) ||
            !expected.Interfaces.SequenceEqual(current.Interfaces, StringComparer.OrdinalIgnoreCase) ||
            expected.Profile != current.Profile || expected.Action != current.Action || expected.Direction != current.Direction ||
            expected.Enabled != current.Enabled) throw new DirectFirewallException("ownership");
    }
    private static string ForId(string id) => $"SELECT * FROM MSFT_NetFirewallRule WHERE InstanceID='{Wql(id)}'";
    private static string Wql(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("'", "\\'", StringComparison.Ordinal);
    private static bool Same(string first, string second) => string.Equals(first, second, StringComparison.OrdinalIgnoreCase);
    private static object NewCom(string id) => Activator.CreateInstance(Type.GetTypeFromProgID(id, true)!) ??
        throw new DirectFirewallException("failed");
    private object Services => services ?? throw new ObjectDisposedException(nameof(CimDirectFirewall));
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
    public void Dispose() { persistentProof.Clear(); removedPaths.Clear(); knownPaths.Clear(); initialPaths.Clear(); Release(services); services = null; Release(locator); locator = null; }
}
