using System.Security.Principal;
using System.Security.AccessControl;
using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class DirectFirewallServiceIdentityTests
{
    private const string UserSid = "S-1-5-21-100-200-300-1001";

    [Fact] public void ServiceOnlyAddsLimitedImageQueryForItsApprovedUser()
    {
        var before = new RawSecurityDescriptor($"O:SYG:SYD:P(D;;0x1;;;{UserSid})(A;;GA;;;SY)(A;;GA;;;BA)");
        var bytes = new byte[before.BinaryLength]; before.GetBinaryForm(bytes, 0);
        var updated = ServiceProcessAccess.WithQueryAccess(bytes, UserSid);
        var after = new RawSecurityDescriptor(updated, 0);
        Assert.Equal(before.Owner, after.Owner); Assert.Equal(before.Group, after.Group);
        Assert.Equal(before.ControlFlags, after.ControlFlags);
        var added = Assert.Single(after.DiscretionaryAcl!.OfType<CommonAce>(), ace =>
            ace.AceQualifier == AceQualifier.AccessAllowed && ace.SecurityIdentifier.Value == UserSid);
        Assert.Equal(0x1000, added.AccessMask); // No terminate, VM, token, DACL or full-query access.
        Assert.Equal(AceFlags.None, added.AceFlags);
        for (var i = 0; i < before.DiscretionaryAcl!.Count; i++)
        {
            var previous = new byte[before.DiscretionaryAcl[i].BinaryLength]; before.DiscretionaryAcl[i].GetBinaryForm(previous, 0);
            var retained = new byte[after.DiscretionaryAcl![i].BinaryLength]; after.DiscretionaryAcl[i].GetBinaryForm(retained, 0);
            Assert.Equal(previous, retained);
        }
        Assert.Equal(updated, ServiceProcessAccess.WithQueryAccess(updated, UserSid));
    }

    [Fact] public void MissingProcessDaclIsNotConvertedIntoAnUnrestrictedPermission()
    {
        var descriptor = new RawSecurityDescriptor(ControlFlags.None, null, null, null, null);
        var bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
        Assert.Throws<DirectFirewallException>(() => ServiceProcessAccess.WithQueryAccess(bytes, UserSid));
    }

    [Theory]
    [InlineData("(D;ID;0x1000;;;WD)")]
    [InlineData("(D;;GA;;;WD)")]
    [InlineData("(D;;GR;;;WD)")]
    public void QueryDenialIsNotOverriddenByAnEarlierExplicitAllow(string deny)
    {
        var descriptor = new RawSecurityDescriptor($"O:SYG:SYD:P(A;;GA;;;SY){deny}");
        var bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
        Assert.Throws<DirectFirewallException>(() => ServiceProcessAccess.WithQueryAccess(bytes, UserSid));
    }

    public static bool ServiceInspectionRequested => Environment.GetEnvironmentVariable("CASMATE_SERVICE_IDENTITY_INTEGRATION") == "1";

    [Fact(Skip = "Opt-in read-only inspection of the installed service", SkipUnless = nameof(ServiceInspectionRequested))]
    public void InstalledServiceImageCanBeVerifiedByNormalUser()
    {
        using var identity = WindowsIdentity.GetCurrent();
        Assert.False(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator));
        var id = DirectFirewallService.Identity(identity.User!.Value);
        Assert.Equal(4u, WindowsFirewallServiceHost.State(DirectFirewallService.Name(id)));
        var pid = WindowsFirewallServiceHost.ProcessId(DirectFirewallService.Name(id));
        Assert.True(pid > 0);
        Assert.True(DirectFirewallService.SamePath(DirectFirewallService.ProcessProgram((int)pid), DirectFirewallService.Executable(id)));
    }
}
