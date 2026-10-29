using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallTests
{
    private static DirectFirewallGrant Grant() => new("d2354a19-7bcb-4a60-90ed-5e90e23e4b6c", "a2354a19-7bcb-4a60-90ed-5e90e23e4b6c",
        "0123456789abcdef01234567", @"C:\Program Files\CasMate\CasMate.exe", "192.168.1.9", "tcp", 54321,
        "{856DB8BE-55DA-4F75-AC34-C1D4823486AD}", "イーサネット 2", "Private");
    private static DirectFirewallRule Rule(DirectFirewallGrant grant, bool enabled = true) => new(DirectFirewall.RuleName(grant),
        $"CasMate Direct {grant.Nonce}", grant.Program, DirectFirewall.ProtocolNumber(grant.Protocol),
        [grant.Port.ToString()], [grant.Address], ["Any"], [grant.InterfaceName], DirectFirewall.ProfileMask(grant.Profile),
        DirectFirewall.Allow, DirectFirewall.Inbound, enabled);
    private static void Error(string code, Action action) => Assert.Equal(code, Assert.Throws<DirectFirewallException>(action).Code);

    [Fact] public void MissingRemovalNeedsNoElevationAndDoesNotMutate()
    {
        var backend = new FakeBackend(); var firewall = new DirectFirewall(backend);
        Assert.True(firewall.TryReadOnly(Grant(), "remove", () => false));
        firewall.Apply(Grant(), "remove", () => false);
        Assert.Empty(backend.Mutations); Assert.Equal(0, backend.AdapterChecks);
    }

    [Fact] public void ProviderFailureIsNeverTreatedAsMissing()
    {
        var backend = new FakeBackend { PersistentError = new IOException("provider disconnected") };
        var firewall = new DirectFirewall(backend);
        Error("failed", () => firewall.TryReadOnly(Grant(), "remove", () => true));
        Error("failed", () => firewall.Apply(Grant(), "allow", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Theory] [InlineData("allow")] [InlineData("remove")]
    public void ReadAccessDeniedRequiresElevationInsteadOfAbortingPreparation(string action)
    {
        var backend = new FakeBackend { PersistentError = new UnauthorizedAccessException("read denied") };
        Assert.False(DirectFirewallHost.TryReadOnly(() => new DirectFirewall(backend).TryReadOnly(Grant(), action, () => true)));
        Assert.Empty(backend.Mutations);
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), action, () => true));
    }

    [Theory] [InlineData("tcp")] [InlineData("udp")]
    public void ElevatedRetryCreatesOnlyTheRequestedScopeAfterReadDenial(string protocol)
    {
        var grant = Grant() with { Protocol = protocol };
        var backend = new FakeBackend { PersistentError = new UnauthorizedAccessException() };
        Assert.False(DirectFirewallHost.TryReadOnly(() => new DirectFirewall(backend).TryReadOnly(grant, "allow", () => true)));
        backend.PersistentError = null;
        new DirectFirewall(backend).Apply(grant, "allow", () => true);
        Assert.Equal(["create"], backend.Mutations);
        Assert.True(DirectFirewall.Matches(grant, backend.Active));
    }

    [Theory] [InlineData("policy")] [InlineData("adapter")]
    public void ElevatedRetryStillRejectsPolicyOrAdapterRefusalAfterReadDenial(string code)
    {
        var backend = new FakeBackend { PersistentError = new UnauthorizedAccessException() };
        Assert.False(DirectFirewallHost.TryReadOnly(() => new DirectFirewall(backend).TryReadOnly(Grant(), "allow", () => true)));
        backend.PersistentError = null; backend.CheckError = code;
        Error(code, () => new DirectFirewall(backend).Apply(Grant(), "allow", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Fact] public void MatchingEffectiveRuleNeedsNoElevation()
    {
        var grant = Grant(); var rule = Rule(grant); var backend = new FakeBackend { Persistent = rule, Active = rule };
        Assert.True(new DirectFirewall(backend).TryReadOnly(grant, "allow", () => true));
        Assert.Equal(1, backend.AdapterChecks); Assert.Equal(1, backend.PolicyChecks); Assert.Empty(backend.Mutations);
    }

    [Fact] public void MissingOrDisabledOrInactiveRuleNeedsMutation()
    {
        var grant = Grant(); var firewall = new DirectFirewall(new FakeBackend());
        Assert.False(firewall.TryReadOnly(grant, "allow", () => true));
        foreach (var backend in new[]
        {
            new FakeBackend { Persistent = Rule(grant, false), Active = Rule(grant, false) },
            new FakeBackend { Persistent = Rule(grant), Active = null },
            new FakeBackend { Persistent = Rule(grant), Active = Rule(grant, false) }
        }) Assert.False(new DirectFirewall(backend).TryReadOnly(grant, "allow", () => true));
    }

    public static IEnumerable<object[]> ScopeMismatches()
    {
        var rule = Rule(Grant());
        yield return [rule with { InstanceId = "another-rule" }];
        yield return [rule with { Description = "CasMate Direct 111111111111111111111111" }];
        yield return [rule with { Program = @"C:\Program Files\Other\Other.exe" }];
        yield return [rule with { Protocol = 17 }];
        yield return [rule with { LocalPorts = ["Any"] }];
        yield return [rule with { LocalPorts = ["54321", "54322"] }];
        yield return [rule with { LocalPorts = ["54321-54321"] }];
        yield return [rule with { LocalAddresses = ["Any"] }];
        yield return [rule with { LocalAddresses = ["192.168.1.10"] }];
        yield return [rule with { LocalAddresses = ["192.168.1.9", "192.168.1.10"] }];
        yield return [rule with { LocalAddresses = ["192.168.1.9/32"] }];
        yield return [rule with { RemoteAddresses = ["192.168.1.4"] }];
        yield return [rule with { RemoteAddresses = ["Any", "192.168.1.4"] }];
        yield return [rule with { Interfaces = ["Wi-Fi"] }];
        yield return [rule with { Interfaces = ["イーサネット 2", "Wi-Fi"] }];
        yield return [rule with { Profile = 7 }];
        yield return [rule with { Action = DirectFirewall.Block }];
        yield return [rule with { Direction = 2 }];
    }

    [Theory] [MemberData(nameof(ScopeMismatches))]
    public void RefusesEachNonOwnedOrBroadenedScope(object data)
    {
        var rule = (DirectFirewallRule)data;
        var backend = new FakeBackend { Persistent = rule, Active = rule }; var firewall = new DirectFirewall(backend);
        Error("ownership", () => firewall.TryReadOnly(Grant(), "allow", () => true));
        Error("ownership", () => firewall.TryReadOnly(Grant(), "remove", () => true));
        Error("ownership", () => firewall.Apply(Grant(), "allow", () => true));
        Error("ownership", () => firewall.Apply(Grant(), "remove", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Fact] public void PreservesWindowsCaseInsensitiveProgramAndRuleName()
    {
        var grant = Grant(); var rule = Rule(grant);
        rule = rule with { InstanceId = rule.InstanceId.ToUpperInvariant(), Description = rule.Description.ToUpperInvariant(), Program = rule.Program.ToLowerInvariant() };
        Assert.True(DirectFirewall.Matches(grant, rule));
        var ipv6 = grant with { Address = "2001:4860:1::9" };
        Assert.True(DirectFirewall.Matches(ipv6, Rule(ipv6) with { LocalAddresses = ["2001:4860:1:0:0:0:0:9"] }));
    }

    [Theory] [InlineData("Domain", "tcp")] [InlineData("Private", "udp")] [InlineData("Public", "udp")]
    public void KeepsProfileProtocolAndInterfaceIdentityForms(string profile, string protocol)
    {
        var grant = Grant() with { Profile = profile, Protocol = protocol, InterfaceId = "856db8be-55da-4f75-ac34-c1d4823486ad" };
        var backend = new FakeBackend();
        new DirectFirewall(backend).Apply(grant, "allow", () => true);
        Assert.True(DirectFirewall.Matches(grant, backend.Active));
        Assert.Equal(DirectFirewall.ProfileMask(profile), backend.Active!.Profile);
        Assert.Equal(DirectFirewall.ProtocolNumber(protocol), backend.Active.Protocol);
    }

    [Fact] public void RefusesActiveStoreCollisionBeforeMutation()
    {
        var backend = new FakeBackend { Active = Rule(Grant()) with { Description = "another owner" } };
        Error("ownership", () => new DirectFirewall(backend).TryReadOnly(Grant(), "allow", () => true));
        Error("ownership", () => new DirectFirewall(backend).Apply(Grant(), "allow", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Theory] [InlineData("adapter")] [InlineData("policy")]
    public void RefusesChangedAdapterAndPolicyBeforeMutation(string code)
    {
        var grant = Grant(); var backend = new FakeBackend { Persistent = Rule(grant), Active = Rule(grant), CheckError = code };
        var firewall = new DirectFirewall(backend);
        Error(code, () => firewall.TryReadOnly(grant, "allow", () => true));
        Error(code, () => firewall.Apply(grant, "allow", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Fact] public void CreatesNarrowRuleAndEnablesOnlyMatchingDisabledRule()
    {
        var grant = Grant(); var backend = new FakeBackend(); var firewall = new DirectFirewall(backend);
        firewall.Apply(grant, "allow", () => true);
        Assert.Equal(["create"], backend.Mutations); Assert.True(DirectFirewall.Matches(grant, backend.Active));
        backend.Mutations.Clear(); backend.Persistent = backend.Active = Rule(grant, false);
        firewall.Apply(grant, "allow", () => true);
        Assert.Equal(["enable"], backend.Mutations); Assert.True(backend.Active!.Enabled);
        backend.Mutations.Clear(); firewall.Apply(grant, "allow", () => true);
        Assert.Empty(backend.Mutations);
    }

    [Fact] public void RechecksPersistentOwnershipImmediatelyBeforeMutation()
    {
        var grant = Grant(); var backend = new FakeBackend { AfterChecks = b => b.Persistent = Rule(grant) with { Program = @"C:\another.exe" } };
        Error("ownership", () => new DirectFirewall(backend).Apply(grant, "allow", () => true));
        Assert.Empty(backend.Mutations);
    }

    [Fact] public void CancelsBeforeCreateAndWhenLivenessProviderFails()
    {
        foreach (var live in new Func<bool>[] { () => false, () => throw new IOException() })
        {
            var backend = new FakeBackend(); var firewall = new DirectFirewall(backend);
            Error("cancelled", () => firewall.TryReadOnly(Grant(), "allow", live));
            Error("cancelled", () => firewall.Apply(Grant(), "allow", live));
            Assert.Empty(backend.Mutations);
        }
        var running = true; var cancelled = new FakeBackend { AfterChecks = _ => running = false };
        Error("cancelled", () => new DirectFirewall(cancelled).Apply(Grant(), "allow", () => running));
        Assert.Empty(cancelled.Mutations);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public void CancellationAfterCreateOrEnableRemovesOnlyRecheckedOwnedRule(bool existing)
    {
        var grant = Grant(); var running = true;
        var backend = new FakeBackend { AfterMutation = _ => running = false, Persistent = existing ? Rule(grant, false) : null };
        Error("cancelled", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal([existing ? "enable" : "create", "remove"], backend.Mutations);
        Assert.Null(backend.Persistent);
        Assert.True(backend.UnrelatedRulePresent);
    }

    [Fact] public void CancellationCannotRemoveConcurrentReplacement()
    {
        var grant = Grant(); var running = true; var other = Rule(grant) with { Description = "other owner" };
        var backend = new FakeBackend { AfterMutation = b => { b.Persistent = other; running = false; } };
        Error("ownership", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal(["create"], backend.Mutations); Assert.Same(other, backend.Persistent);
    }

    [Fact] public void CancellationAfterEffectiveVerificationRechecksPersistentRule()
    {
        var grant = Grant(); var running = true;
        var backend = new FakeBackend { AfterActiveRead = (b, reads) => { if (reads == 2) running = false; } };
        Error("cancelled", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal(["create", "remove"], backend.Mutations); Assert.Null(backend.Persistent);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public void CancellationWithPartiallyCompletedMutationErrorRemovesOwnedRule(bool existing)
    {
        var grant = Grant(); var running = true;
        var backend = new FakeBackend
        {
            Persistent = existing ? Rule(grant, false) : null,
            AfterMutation = _ => { running = false; throw new IOException("provider failed after mutation"); }
        };
        Error("cancelled", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal([existing ? "enable" : "create", "remove"], backend.Mutations); Assert.Null(backend.Persistent);
    }

    [Theory] [InlineData("queryFailure")] [InlineData("differentScope")] [InlineData("absent")]
    public void CancellationDuringFailedEffectiveVerificationStillRemovesRecheckedOwnedRule(string fault)
    {
        var grant = Grant(); var running = true;
        var backend = new FakeBackend
        {
            AfterActiveRead = (current, reads) =>
            {
                if (reads != 2) return;
                running = false;
                if (fault == "queryFailure") throw new IOException("active provider unavailable");
                current.Active = fault == "absent" ? null : Rule(grant) with { LocalPorts = ["Any"] };
            }
        };
        Error("cancelled", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal(["create", "remove"], backend.Mutations); Assert.Null(backend.Persistent);
    }

    [Fact] public void MutationErrorWithoutCancellationRetainsFailureAndDoesNotRollback()
    {
        var backend = new FakeBackend { AfterMutation = _ => throw new IOException("provider failed after mutation") };
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), "allow", () => true));
        Assert.Equal(["create"], backend.Mutations); Assert.NotNull(backend.Persistent);
    }

    [Fact] public void MutationErrorWithCancellationCannotRemoveConcurrentReplacement()
    {
        var grant = Grant(); var running = true; var other = Rule(grant) with { Description = "other owner" };
        var backend = new FakeBackend { AfterMutation = current =>
        {
            current.Persistent = other; running = false; throw new IOException("provider failed after collision");
        } };
        Error("ownership", () => new DirectFirewall(backend).Apply(grant, "allow", () => running));
        Assert.Equal(["create"], backend.Mutations); Assert.Same(other, backend.Persistent);
    }

    [Fact] public void CancellationRollbackMustVerifyPersistentAbsence()
    {
        var running = true; var backend = new FakeBackend { KeepAfterRemove = true, AfterMutation = _ => running = false };
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), "allow", () => running));
        Assert.Equal(["create", "remove"], backend.Mutations); Assert.NotNull(backend.Persistent);
    }

    [Fact] public void CancellationRollbackReadFailureRetainsFailureWithoutUnsafeRemoval()
    {
        var running = true; var backend = new FakeBackend { AfterMutation = current =>
        {
            running = false; current.PersistentError = new IOException("rollback ownership unavailable");
        } };
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), "allow", () => running));
        Assert.Equal(["create"], backend.Mutations); Assert.NotNull(backend.Persistent);
    }

    [Fact] public void ActiveStoreFailureNeverReportsReady()
    {
        var backend = new FakeBackend { PublishActive = false };
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), "allow", () => true));
        Assert.Equal(["create"], backend.Mutations);
        var queryFailure = new FakeBackend { ActiveError = new IOException() };
        Error("failed", () => new DirectFirewall(queryFailure).TryReadOnly(Grant(), "allow", () => true));
        Assert.Empty(queryFailure.Mutations);
    }

    [Fact] public void RemovalVerifiesAbsenceAndReportsResidual()
    {
        var grant = Grant(); var backend = new FakeBackend { Persistent = Rule(grant), KeepAfterRemove = true };
        Error("failed", () => new DirectFirewall(backend).Apply(grant, "remove", () => false));
        Assert.Equal(["remove"], backend.Mutations); Assert.NotNull(backend.Persistent); Assert.True(backend.UnrelatedRulePresent);
        backend.KeepAfterRemove = false;
        new DirectFirewall(backend).Apply(grant, "remove", () => false);
        Assert.Null(backend.Persistent); Assert.True(backend.UnrelatedRulePresent);
    }

    [Theory]
    [InlineData("0.0.0.0")] [InlineData("127.0.0.1")] [InlineData("100.64.0.1")] [InlineData("169.254.1.2")]
    [InlineData("192.0.2.1")] [InlineData("192.88.99.1")] [InlineData("198.18.0.1")] [InlineData("198.51.100.1")]
    [InlineData("203.0.113.1")] [InlineData("224.0.0.1")] [InlineData("255.255.255.255")]
    [InlineData("192.168.001.9")] [InlineData("0xc0a80109")] [InlineData("192.168.1")]
    [InlineData("::")] [InlineData("::1")] [InlineData("fc00::1")] [InlineData("fe80::1%4")] [InlineData("ff02::1")]
    [InlineData("::ffff:192.168.1.9")] [InlineData("2002:c0a8:0109::1")] [InlineData("2001:0:1234::1")]
    [InlineData("2001:db8::1")] [InlineData("2001:4860::192.168.1.9")] [InlineData("2001:4860:1::9/64")]
    public void RejectsUnspecifiedReservedAndEmbeddedAddresses(string address)
    {
        var backend = new FakeBackend(); var grant = Grant() with { Address = address };
        Error("failed", () => new DirectFirewall(backend).Apply(grant, "allow", () => true));
        Assert.Empty(backend.Mutations); Assert.Equal(0, backend.AdapterChecks);
    }

    [Theory] [InlineData("10.0.0.1")] [InlineData("172.16.0.1")] [InlineData("192.168.1.9")]
    [InlineData("8.8.8.8")] [InlineData("2001:4860:1::9")] [InlineData("2400:8500:1::1")]
    public void AllowsValidatedPrivateLanAndPublicAddresses(string address) => Assert.True(DirectFirewall.AllowedAddress(address));

    [Theory]
    [InlineData("id")] [InlineData("pcId")] [InlineData("nonce")] [InlineData("protocol")] [InlineData("profile")]
    [InlineData("idNewline")] [InlineData("nonceNewline")] [InlineData("interfaceIdWhitespace")]
    [InlineData("interfaceAny")] [InlineData("interfaceWildcard")] [InlineData("interfaceWildcardCharacter")]
    [InlineData("portLow")] [InlineData("portHigh")] [InlineData("program")] [InlineData("interfaceId")] [InlineData("interfaceName")]
    public void RejectsMalformedRequestsBeforeProviderAccess(string field)
    {
        var grant = Grant();
        grant = field switch
        {
            "id" => grant with { Id = "*" }, "pcId" => grant with { PcId = "other" }, "nonce" => grant with { Nonce = "*" },
            "idNewline" => grant with { Id = grant.Id + "\n" }, "nonceNewline" => grant with { Nonce = grant.Nonce + "\n" },
            "interfaceIdWhitespace" => grant with { InterfaceId = " " + grant.InterfaceId },
            "interfaceAny" => grant with { InterfaceName = "aNy" }, "interfaceWildcard" => grant with { InterfaceName = "*" },
            "interfaceWildcardCharacter" => grant with { InterfaceName = "Wi-Fi?" },
            "protocol" => grant with { Protocol = "Any" }, "profile" => grant with { Profile = "Any" },
            "portLow" => grant with { Port = 1023 }, "portHigh" => grant with { Port = 65536 },
            "program" => grant with { Program = "CasMate.exe" }, "interfaceId" => grant with { InterfaceId = "*" },
            _ => grant with { InterfaceName = "\r\n" }
        };
        var backend = new FakeBackend();
        Error("failed", () => new DirectFirewall(backend).Apply(grant, "allow", () => true));
        Assert.Equal(0, backend.PersistentReads); Assert.Empty(backend.Mutations);
        Error("failed", () => new DirectFirewall(backend).Apply(Grant(), "invalid", () => true));
    }

    [Theory] [InlineData("Any", true)] [InlineData("54321", true)] [InlineData("50000-55000", true)]
    [InlineData("54321-54321", true)] [InlineData("54322", false)] [InlineData("1-50000", false)]
    [InlineData("55000-50000", false)] [InlineData("RPC", false)] [InlineData("54321-Any", false)]
    public void BlockPortRangesIncludeBoundaries(string port, bool expected) =>
        Assert.Equal(expected, DirectFirewall.PortIncludes([port], 54321));

    private sealed class FakeBackend : IDirectFirewallBackend
    {
        public DirectFirewallRule? Persistent, Active;
        public Exception? PersistentError, ActiveError;
        public string? CheckError;
        public bool PublishActive = true, KeepAfterRemove;
        public bool UnrelatedRulePresent = true;
        public int AdapterChecks, PolicyChecks, PersistentReads, ActiveReads;
        public Action<FakeBackend>? AfterChecks, AfterMutation;
        public Action<FakeBackend, int>? AfterActiveRead;
        public readonly List<string> Mutations = [];
        public DirectFirewallRule? ReadPersistent(string id)
        {
            PersistentReads++; if (PersistentError is not null) throw PersistentError;
            return Persistent;
        }
        public DirectFirewallRule? ReadActive(string id)
        {
            ActiveReads++; AfterActiveRead?.Invoke(this, ActiveReads);
            if (ActiveError is not null) throw ActiveError;
            return Active;
        }
        public void CheckAdapter(DirectFirewallGrant grant)
        {
            AdapterChecks++; if (CheckError == "adapter") throw new DirectFirewallException("adapter");
        }
        public void CheckPolicyAndBlocks(DirectFirewallGrant grant)
        {
            PolicyChecks++; if (CheckError == "policy") throw new DirectFirewallException("policy"); AfterChecks?.Invoke(this);
        }
        public void Create(DirectFirewallGrant grant)
        {
            Mutations.Add("create"); Persistent = Rule(grant); if (PublishActive) Active = Persistent; AfterMutation?.Invoke(this);
        }
        public void Enable(string id)
        {
            Assert.Equal(Persistent!.InstanceId, id); Mutations.Add("enable"); Persistent = Persistent with { Enabled = true };
            if (PublishActive) Active = Persistent; AfterMutation?.Invoke(this);
        }
        public void Remove(string id)
        {
            Assert.Equal(Persistent!.InstanceId, id); Mutations.Add("remove"); if (!KeepAfterRemove) Persistent = Active = null;
        }
    }
}
