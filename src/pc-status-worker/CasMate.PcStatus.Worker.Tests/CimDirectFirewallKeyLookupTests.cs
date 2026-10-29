using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class CimDirectFirewallKeyLookupTests
{
    private const string Id = "CasMate-Direct-pc-owned";
    private const string RulePath = "MSFT_NetFirewallRule.CreationClassName=\"MSFT|FW|FirewallRule|" + Id + "\",PolicyRuleName=\"\",SystemCreationClassName=\"\",SystemName=\"\"";
    private const string CreationAlias = "MSFT_NetFirewallRule.CreationClassName=\"\",PolicyRuleName=\"" + Id + "\",SystemCreationClassName=\"\",SystemName=\"\"";

    [Fact] public void ProviderCreationAliasIsResolvedBeforeSavingTheNextRemovalLocation()
    {
        var provider = new Provider(false) { Alias = true };
        using var backend = new CimDirectFirewall(provider);
        backend.Create(new("owned", "pc", "nonce", @"C:\Apps\CasMate.exe", "192.168.1.7", "tcp", 3001,
            Guid.NewGuid().ToString(), "Ethernet", "Private"));
        Assert.Null(backend.PersistentPath(Id));
        Assert.NotNull(backend.ReadActive(Id));
        Assert.Equal(RulePath, backend.PersistentPath(Id)); Assert.Equal(0, provider.RuleQueries);
    }

    [Fact] public void RollbackCannotUseTheAbsenceDiscoveredBeforeCreation()
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        backend.InitialPaths(Id, [], "remove");
        Assert.NotNull(backend.ReadPersistent(Id)); backend.Remove(Id);
        Assert.True(provider.Removed); Assert.Equal(1, provider.RuleQueries);
    }

    [Fact] public void ProtectedKeyHintSkipsSearchButStillReadsAndRechecksAllOwnershipFields()
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        backend.HintPersistentPath(Id, RulePath);
        Assert.NotNull(backend.ReadPersistent(Id)); provider.Changed = true;
        Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.Remove(Id)).Code);
        Assert.False(provider.Removed); Assert.Equal(0, provider.RuleQueries); Assert.Equal(8, provider.FilterReads);
    }

    [Fact] public void BatchedAbsenceIsConsumedOnlyOnceAndDoesNotSkipThePreMutationSearch()
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        backend.InitialPaths(Id, []); Assert.Null(backend.ReadPersistent(Id));
        Assert.NotNull(backend.ReadPersistent(Id)); Assert.Equal(1, provider.RuleQueries);
    }

    [Fact] public void BatchedDiscoveryOnlySharesKeysAndDuplicateFailureStaysWithThatTarget()
    {
        var provider = new Provider(false) { Duplicate = true };
        using var discovery = new CimDirectFirewall(provider);
        var found = discovery.DiscoverPaths([Id, "CasMate-Direct-other"]);
        Assert.Empty(found["CasMate-Direct-other"]); Assert.Equal(2, found[Id].Length); Assert.Equal(0, provider.FilterReads);
        using var target = new CimDirectFirewall(new Provider(false)); target.InitialPaths(Id, found[Id]);
        Assert.Equal("failed", Assert.Throws<DirectFirewallException>(() => target.ReadPersistent(Id)).Code);
    }

    [Fact] public void CreatedRuleIsFreshlyVerifiedInActiveStoreByTheReturnedKeys()
    {
        var provider = new Provider(false) { InitiallyAbsent = true };
        using var backend = new CimDirectFirewall(provider);
        Assert.Null(backend.ReadActive(Id));
        backend.Create(new("owned", "pc", "nonce", @"C:\Apps\CasMate.exe", "192.168.1.7", "tcp", 3001,
            Guid.NewGuid().ToString(), "Ethernet", "Private"));
        provider.Changed = true;
        Assert.Equal("foreign owner", backend.ReadActive(Id)!.Description);
        Assert.Equal(1, provider.RuleQueries);
        Assert.Equal(4, provider.FilterReads);
    }

    [Fact] public void MissingKnownObjectFallsBackToUniqueSearchInsteadOfAssumingAbsence()
    {
        var provider = new Provider(false) { AllowRepeatedQuery = true };
        using var backend = new CimDirectFirewall(provider);
        Assert.NotNull(backend.ReadPersistent(Id));
        provider.Removed = true; provider.Changed = true;
        Assert.Equal("foreign owner", backend.ReadPersistent(Id)!.Description);
        Assert.Equal(2, provider.RuleQueries);
    }

    [Fact] public void DuplicateInitialSearchCannotEstablishAKnownPath()
    {
        using var backend = new CimDirectFirewall(new Provider(false) { Duplicate = true });
        Assert.Equal("failed", Assert.Throws<DirectFirewallException>(() => backend.ReadPersistent(Id)).Code);
        Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.Remove(Id)).Code);
    }

    [Fact] public void RepeatedPreparationReadsFetchFreshScopeWithoutRepeatingTheUniqueSearch()
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        Assert.NotNull(backend.ReadPersistent(Id));
        provider.Changed = true;
        Assert.Equal("foreign owner", backend.ReadPersistent(Id)!.Description);
        Assert.Equal(1, provider.RuleQueries);
        Assert.Equal(8, provider.FilterReads);
    }

    [Theory] [InlineData(unchecked((int)0x80070005))] [InlineData(unchecked((int)0x800706BA))]
    public void KnownPathReadFailureCannotReuseAnEarlierSuccessfulProof(int error)
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        Assert.NotNull(backend.ReadPersistent(Id));
        provider.Removed = true; provider.PostDeleteError = error;
        Assert.Throws<System.Runtime.InteropServices.COMException>(() => backend.ReadPersistent(Id));
        Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.Remove(Id)).Code);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public void MutationRechecksExactObjectAndConsumesItsProof(bool changed)
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        Assert.NotNull(backend.ReadPersistent(Id)); provider.Changed = changed;
        if (changed) Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.Remove(Id)).Code);
        else backend.Remove(Id);
        Assert.Equal(!changed, provider.Removed);
        if (!changed) Assert.Null(backend.ReadPersistent(Id));
        Assert.Equal(1, provider.RuleQueries);
        Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.Remove(Id)).Code);
    }

    [Fact] public void OwnedScopeIsReadByExactProviderKeysWithoutSlowAssociationEnumeration()
    {
        var provider = new Provider(false);
        using var backend = new CimDirectFirewall(provider);
        var rule = backend.ReadPersistent(Id);
        Assert.NotNull(rule); Assert.Equal(@"C:\Apps\CasMate.exe", rule.Program);
        Assert.Equal(["3001"], rule.LocalPorts); Assert.Equal(["192.168.1.7"], rule.LocalAddresses);
        Assert.Equal(["Any"], rule.RemoteAddresses); Assert.Equal(["Ethernet"], rule.Interfaces);
        Assert.Equal(4, provider.FilterReads);
    }

    [Fact] public void FilterFromAnotherProviderObjectCannotBecomeAnOwnershipProof()
    {
        using var backend = new CimDirectFirewall(new Provider(true));
        Assert.Equal("ownership", Assert.Throws<DirectFirewallException>(() => backend.ReadPersistent(Id)).Code);
    }

    [Theory] [InlineData(unchecked((int)0x80070005))] [InlineData(unchecked((int)0x800706BA))]
    public void PostDeleteAccessOrTransportFailureDoesNotProveAbsence(int error)
    {
        var provider = new Provider(false) { PostDeleteError = error };
        using var backend = new CimDirectFirewall(provider);
        Assert.NotNull(backend.ReadPersistent(Id)); backend.Remove(Id);
        Assert.Throws<System.Runtime.InteropServices.COMException>(() => backend.ReadPersistent(Id));
    }

    public sealed class Provider(bool substitute)
    {
        public int FilterReads;
        public int RuleQueries;
        public int PostDeleteError = unchecked((int)0x80041002);
        public bool Changed, Removed, InitiallyAbsent, Created, AllowRepeatedQuery, Duplicate, Alias;
        private static Dictionary<string, object> Keys(string id = Id) => new()
        {
            ["InstanceID"] = id, ["CreationClassName"] = "MSFT|FW|FirewallRule|" + id,
            ["SystemCreationClassName"] = "", ["SystemName"] = "", ["Name"] = "", ["PolicyRuleName"] = ""
        };
        public object[] ExecQuery(string query, string language, int flags, object context)
        {
            Assert.DoesNotContain("ASSOCIATORS", query);
            RuleQueries++;
            if (!AllowRepeatedQuery) Assert.Equal(1, RuleQueries);
            if (InitiallyAbsent && !Created) return [];
            return Duplicate ? [Rule(), Rule()] : [Rule()];
        }
        private Row Rule()
        {
            var data = Keys();
            data["Description"] = Changed ? "foreign owner" : "CasMate Direct nonce"; data["Enabled"] = 1u; data["Profiles"] = 2u;
            data["Action"] = 2u; data["Direction"] = 1u;
            return new Row(data, () => Removed = true);
        }
        public object Get(string path, int flags, object context)
        {
            if (path == "MSFT_NetFirewallRule") return new RuleClass(this);
            if (path.StartsWith("MSFT_NetFirewallRule."))
            {
                Assert.True(path == RulePath || Created && Alias && path == CreationAlias);
                if (Removed) throw new System.Runtime.InteropServices.COMException("Provider failure", PostDeleteError);
                return Rule();
            }
            Assert.Contains($"CreationClassName=\"MSFT|FW|FirewallRule|{Id}\"", path);
            Assert.Contains("Name=\"\"", path); Assert.Contains("SystemCreationClassName=\"\"", path); Assert.Contains("SystemName=\"\"", path);
            FilterReads++;
            var data = Keys(substitute ? "foreign-rule" : Id);
            if (path.StartsWith("MSFT_NetApplicationFilter.")) data["AppPath"] = @"C:\Apps\CasMate.exe";
            else if (path.StartsWith("MSFT_NetProtocolPortFilter.")) { data["Protocol"] = "TCP"; data["LocalPort"] = new[] { "3001" }; }
            else if (path.StartsWith("MSFT_NetAddressFilter.")) { data["LocalAddress"] = new[] { "192.168.1.7" }; data["RemoteAddress"] = new[] { "Any" }; }
            else if (path.StartsWith("MSFT_NetInterfaceFilter.")) data["InterfaceAlias"] = new[] { "Ethernet" };
            else throw new InvalidOperationException("Unexpected provider class");
            return new CimDirectFirewallScopeTests.Row(data);
        }
    }
    public sealed class RuleClass(Provider provider) { public CreationRow SpawnInstance_(int flags) => new(provider); }
    public sealed class CreationRow(Provider provider)
    {
        public CreationProperties Properties_ => new();
        public ObjectPath Put_(int flags, object context)
        {
            Assert.Equal(2, flags); provider.Created = true; return new(provider.Alias ? CreationAlias : RulePath);
        }
    }
    public sealed class CreationProperties { public CreationProperty Item(string name, int flags) => new(); }
    public sealed class CreationProperty { public object? Value { get; set; } }
    public sealed class Row(Dictionary<string, object> data, Action delete)
    {
        public CimDirectFirewallScopeTests.Properties Properties_ => new(data);
        public ObjectPath Path_ => new();
        public void Delete_(int flags, object context) => delete();
    }
    public sealed class ObjectPath(string path = RulePath) { public string RelPath => path; }
}
