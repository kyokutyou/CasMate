using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text.Json;

namespace CasMate.PcStatus.Worker;

internal static class DirectFirewallServiceSetup
{
    private static readonly string[] Administrators = ["S-1-5-18", "S-1-5-32-544"];
    internal static void ValidateProtectedDirectory(string directory)
    {
        DirectFirewallHost.RejectReparsePoints(directory);
        var security = new DirectoryInfo(directory).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);
        if (!Administrators.Contains(security.GetOwner(typeof(SecurityIdentifier))?.Value)) throw new DirectFirewallException("ownership");
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && !Administrators.Contains(rule.IdentityReference.Value) &&
                (rule.FileSystemRights & (FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
                    FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership)) != 0)
                throw new DirectFirewallException("ownership");
    }
    private static void CreateProtectedDirectory(string directory)
    {
        if (Directory.Exists(directory)) { ValidateProtectedDirectory(directory); return; }
        var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
        security.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
        foreach (var sid in Administrators) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-32-545"), FileSystemRights.ReadAndExecute,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        FileSystemAclExtensions.CreateDirectory(security, directory);
        ValidateProtectedDirectory(directory);
    }
    internal static void Install(DirectFirewallJob job, Func<bool> live)
    {
        var worker = Environment.ProcessPath!;
        var config = DirectFirewallService.Expected(job, worker, verifyRuntime: true);
        var id = DirectFirewallService.Identity(job.UserSid);
        CreateProtectedDirectory(DirectFirewallService.Root);
        CreateProtectedDirectory(DirectFirewallService.DirectoryFor(id));
        using var locks = DirectFirewallHost.LockDirectoryPath(DirectFirewallService.DirectoryFor(id));
        if (!live()) throw new DirectFirewallException("cancelled");
        var previous = File.Exists(DirectFirewallService.ConfigPath(id)) ? DirectFirewallService.ReadConfig(id) : null;
        WindowsFirewallServiceHost.Stop(DirectFirewallService.Name(id));
        if (previous is not null && previous.PcId != config.PcId) RemoveOwned(id);
        var runtime = Path.Combine(DirectFirewallService.DirectoryFor(id), "runtime-" + config.Fingerprint);
        CreateProtectedDirectory(runtime);
        // No runtime code is executed from the original user-writable installation by the service.
        using var sourceLocks = DirectFirewallHost.LockDirectoryPath(Path.GetDirectoryName(worker)!);
        foreach (var source in DirectFirewallService.RuntimeFiles(Path.GetDirectoryName(worker)!))
        {
            DirectFirewallHost.RejectReparsePoints(source);
            CopyRuntimeFile(source, Path.Combine(runtime, Path.GetFileName(source)));
        }
        if (DirectFirewallService.Fingerprint(runtime) != config.Fingerprint || !live()) throw new DirectFirewallException("cancelled");
        WriteJson(DirectFirewallService.ConfigPath(id), config);
        WindowsFirewallServiceHost.Register(DirectFirewallService.Name(id), DirectFirewallService.Executable(id), id, config.UserSid);
    }
    internal static void CopyRuntimeFile(string source, string target)
    {
        DirectFirewallHost.RejectReparsePoints(source);
        using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        var expected = SHA256.HashData(input); input.Position = 0;
        if (File.Exists(target))
        {
            DirectFirewallHost.RejectReparsePoints(target);
            using var existing = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(existing))) return;
        }
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { input.CopyTo(output); output.Flush(true); }
            File.Move(temporary, target, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static void WriteJson<T>(string path, T value)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { JsonSerializer.Serialize(output, value, DirectFirewallService.Json); output.Flush(true); }
            if (File.Exists(path)) DirectFirewallHost.RejectReparsePoints(path);
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal static DirectFirewallResult ApplyRecorded(string id, DirectFirewallRequest request, Func<bool> live)
    {
        var path = Path.Combine(DirectFirewallService.DirectoryFor(id), "owned.json");
        var owned = ReadOwned(id).ToDictionary(grant => grant.Id, StringComparer.Ordinal);
        var hintsPath = Path.Combine(DirectFirewallService.DirectoryFor(id), "rule-paths.json");
        var hints = DirectFirewallPathHints.Load(hintsPath);
        var conflicts = new HashSet<string>(StringComparer.Ordinal);
        var changed = false;
        if (request.Action == "allow")
        {
            foreach (var grant in new[] { request.Grant }.Concat(request.Grants ?? []))
            {
                if (owned.TryGetValue(grant.Id, out var old) && old != grant) { conflicts.Add(grant.Id); continue; }
                if (!owned.ContainsKey(grant.Id))
                {
                    if (owned.Count >= 4096) { conflicts.Add(grant.Id); continue; }
                    owned[grant.Id] = grant; changed = true;
                }
            }
            if (changed) WriteJson(path, owned.Values.ToArray()); // One durable batch intent before any mutation.
            changed = false;
        }
        var removalLock = new object();
        var grants = new[] { request.Grant }.Concat(request.Grants ?? []).ToArray();
        var locations = grants.ToDictionary(grant => grant.Id, grant => hints.For(grant), StringComparer.Ordinal);
        Dictionary<string, string[]>? initial = null;
        var unknown = grants.Where(grant => locations[grant.Id] is null && !conflicts.Contains(grant.Id)).Select(DirectFirewall.RuleName).ToArray();
        if (request.Action == "allow" && unknown.Length > 1)
        {
            try { using var discovery = new CimDirectFirewall(); initial = discovery.DiscoverPaths(unknown); }
            catch { /* A shared lookup failure falls back to each target's authoritative query. */ }
        }
        var result = DirectFirewallHost.ApplyBatch(request, live, (grant, action, check) =>
        {
            if (conflicts.Contains(grant.Id)) throw new DirectFirewallException("ownership");
            // Concurrent targets must never share a COM session or its one-use ownership proofs.
            using var backend = new CimDirectFirewall();
            string? location;
            lock (removalLock) location = hints.For(grant);
            if (location is not null) backend.HintPersistentPath(DirectFirewall.RuleName(grant), location);
            else if (initial?.TryGetValue(DirectFirewall.RuleName(grant), out var paths) == true) backend.InitialPaths(DirectFirewall.RuleName(grant), paths, action);
            new DirectFirewall(backend).Apply(grant, action, check);
            lock (removalLock)
            {
                if (action == "remove") { if (owned.Remove(grant.Id)) changed = true; hints.Remove(grant.Id); }
                else hints.Remember(grant, backend.PersistentPath(DirectFirewall.RuleName(grant)));
            }
        }, parallel: true);
        if (changed) WriteJson(path, owned.Values.ToArray());
        hints.Save(hintsPath, owned.Values); // Optional acceleration must not redefine authoritative commit success.
        return result;
    }
    private static DirectFirewallGrant[] ReadOwned(string id)
    {
        var path = Path.Combine(DirectFirewallService.DirectoryFor(id), "owned.json");
        if (!File.Exists(path)) return [];
        DirectFirewallHost.RejectReparsePoints(path);
        // A bounded protected ledger, distinct from the 64 KiB IPC message limit.
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length > 16 * 1024 * 1024) throw new DirectFirewallException("failed");
        return JsonSerializer.Deserialize<DirectFirewallGrant[]>(input, DirectFirewallService.Json) ?? throw new DirectFirewallException("failed");
    }
    private static void RemoveOwned(string id)
    {
        var hintsPath = Path.Combine(DirectFirewallService.DirectoryFor(id), "rule-paths.json");
        var hints = DirectFirewallPathHints.Load(hintsPath);
        foreach (var grant in ReadOwned(id))
        {
            using var backend = new CimDirectFirewall();
            if (hints.For(grant) is { } location) backend.HintPersistentPath(DirectFirewall.RuleName(grant), location);
            new DirectFirewall(backend).Apply(grant, "remove", () => true);
            hints.Remove(grant.Id);
        }
        WriteJson(Path.Combine(DirectFirewallService.DirectoryFor(id), "owned.json"), Array.Empty<DirectFirewallGrant>());
        hints.Save(hintsPath, []);
    }
    internal static bool NeedsRemoval(DirectFirewallServiceConfig? config, string currentWorker, uint state)
    {
        if (config is null)
        {
            if (state != 0) throw new DirectFirewallException("failed");
            return false;
        }
        return DirectFirewallService.SamePath(config.WorkerProgram, currentWorker);
    }
    internal static int Uninstall(string id, bool elevated)
    {
        try
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, "\\A[a-f0-9]{32}\\z")) return 1;
            if (!Directory.Exists(DirectFirewallService.DirectoryFor(id))) return 0;
            ValidateProtectedDirectory(DirectFirewallService.Root);
            ValidateProtectedDirectory(DirectFirewallService.DirectoryFor(id));
            var config = File.Exists(DirectFirewallService.ConfigPath(id)) ? DirectFirewallService.ReadConfig(id) : null;
            if (config is null) return NeedsRemoval(null, Environment.ProcessPath!, WindowsFirewallServiceHost.State(DirectFirewallService.Name(id))) ? 1 : 0;
            if (!elevated)
            {
                // An older, separately installed copy must not remove the current installation's service.
                if (!NeedsRemoval(config, Environment.ProcessPath!, WindowsFirewallServiceHost.State(DirectFirewallService.Name(id)))) return 0;
                var start = new ProcessStartInfo(DirectFirewallService.Executable(id))
                { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                start.ArgumentList.Add("--direct-firewall-uninstall-elevated"); start.ArgumentList.Add(id);
                using var process = Process.Start(start) ?? throw new DirectFirewallException("failed");
                return process.WaitForExit(120_000) ? process.ExitCode : 1;
            }
            if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return 1;
            WindowsFirewallServiceHost.Stop(DirectFirewallService.Name(id));
            RemoveOwned(id);
            WindowsFirewallServiceHost.Delete(DirectFirewallService.Name(id));
            // The current elevated uninstaller can still have runtime DLLs mapped.
            // Inactive protected runtime files may remain; no registered service can start them.
            File.Delete(DirectFirewallService.ConfigPath(id));
            File.Delete(Path.Combine(DirectFirewallService.DirectoryFor(id), "owned.json"));
            return 0;
        }
        catch { return 1; }
    }
}
