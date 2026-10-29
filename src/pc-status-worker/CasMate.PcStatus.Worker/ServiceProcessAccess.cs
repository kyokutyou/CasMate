using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

namespace CasMate.PcStatus.Worker;

internal static class ServiceProcessAccess
{
    internal const int QueryLimitedInformation = 0x1000;

    internal static byte[] WithQueryAccess(byte[] descriptor, string userSid)
    {
        var security = new RawSecurityDescriptor(descriptor, 0);
        var acl = security.DiscretionaryAcl ?? throw new DirectFirewallException("ownership");
        var sid = new SecurityIdentifier(userSid);
        // An explicit allow could precede an inherited deny. Fail closed for any query denial,
        // including group/conditional denies whose applicability we cannot safely infer here.
        const int queryDenials = QueryLimitedInformation | 0x0400 | unchecked((int)0x90000000);
        if (acl.OfType<QualifiedAce>().Any(ace => ace.AceQualifier == AceQualifier.AccessDenied && (ace.AccessMask & queryDenials) != 0))
            throw new DirectFirewallException("ownership");
        // Keep all existing permissions and denies. Never turn a null DACL into a broad allow.
        if (!acl.OfType<CommonAce>().Any(ace => ace.AceQualifier == AceQualifier.AccessAllowed &&
            ace.SecurityIdentifier == sid && ace.AccessMask == QueryLimitedInformation && ace.AceFlags == AceFlags.None))
        {
            var index = 0;
            while (index < acl.Count && (acl[index].AceFlags & AceFlags.Inherited) == 0) index++;
            acl.InsertAce(index, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, QueryLimitedInformation, sid, false, null));
        }
        var result = new byte[security.BinaryLength]; security.GetBinaryForm(result, 0); return result;
    }

    internal static void AllowCurrentProcessQuery(string userSid)
    {
        const uint dacl = 4; // DACL_SECURITY_INFORMATION; do not touch owner, group or SACL.
        var process = GetCurrentProcess();
        GetKernelObjectSecurity(process, dacl, null, 0, out var length);
        if (length == 0 || length > 1_048_576) throw new Win32Exception(Marshal.GetLastWin32Error());
        var descriptor = new byte[length];
        if (!GetKernelObjectSecurity(process, dacl, descriptor, length, out _)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!SetKernelObjectSecurity(process, dacl, WithQueryAccess(descriptor, userSid))) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    [DllImport("kernel32.dll")] private static extern nint GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetKernelObjectSecurity(nint handle, uint information, byte[]? descriptor, uint length, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetKernelObjectSecurity(nint handle, uint information, byte[] descriptor);
}
