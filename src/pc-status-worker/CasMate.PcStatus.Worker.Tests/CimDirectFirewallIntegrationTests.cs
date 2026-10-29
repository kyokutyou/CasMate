using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class CimDirectFirewallIntegrationTests
{
    public static bool IntegrationRequested => Environment.GetEnvironmentVariable("CASMATE_FIREWALL_INTEGRATION") == "1" ||
        Environment.GetCommandLineArgs().Contains(typeof(CimDirectFirewallIntegrationTests).FullName!, StringComparer.Ordinal);
    [Fact(Skip = "Explicit elevated firewall integration run only", SkipUnless = nameof(IntegrationRequested))] public void CreatesVerifiesAndRemovesOneExplicitlyRequestedIsolatedRule()
    {
        // Routine test runs must not request elevation or change the firewall.
        Assert.True(OperatingSystem.IsWindows());
        using var identity = WindowsIdentity.GetCurrent();
        Assert.True(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator), "This opt-in test requires an elevated runner.");
        var adapter = DirectNetwork.Read().First(candidate => candidate.Addresses.Any(address =>
            address.Family == "ipv4" && DirectFirewall.AllowedAddress(address.Address)));
        var address = adapter.Addresses.First(candidate => candidate.Family == "ipv4" && DirectFirewall.AllowedAddress(candidate.Address)).Address;
        using var process = Process.GetCurrentProcess();
        var program = process.MainModule!.FileName;
        var grant = new DirectFirewallGrant(Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"),
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)), program, address, "tcp",
            RandomNumberGenerator.GetInt32(49_152, 65_536), adapter.Id, adapter.Name, adapter.Profile);
        var id = DirectFirewall.RuleName(grant);
        Console.WriteLine($"Isolated firewall integration rule: {id}; TCP {grant.Address}:{grant.Port}; program {program}");
        // There is no listener: the permission is for this short-lived test executable only.
        using var backend = new CimDirectFirewall();
        var firewall = new DirectFirewall(backend);
        Assert.Null(backend.ReadPersistent(id));
        try
        {
            firewall.Apply(grant, "allow", () => true);
            var persistent = backend.ReadPersistent(id); var active = backend.ReadActive(id);
            Assert.NotNull(persistent); Assert.NotNull(active);
            Assert.True(DirectFirewall.Matches(grant, persistent)); Assert.True(DirectFirewall.Matches(grant, active));
            Assert.True(persistent.Enabled); Assert.True(active.Enabled);
            Assert.True(firewall.TryReadOnly(grant, "allow", () => true));
        }
        finally
        {
            try
            {
                firewall.Apply(grant, "remove", () => true);
                Assert.Null(backend.ReadPersistent(id));
                Assert.True(firewall.TryReadOnly(grant, "remove", () => true));
                Console.WriteLine($"Isolated firewall integration rule removed: {id}");
            }
            catch (Exception error)
            {
                throw new InvalidOperationException($"Isolated firewall rule cleanup could not be confirmed: {id}", error);
            }
        }
    }

    [Fact(Skip = "Explicit elevated firewall integration run only", SkipUnless = nameof(IntegrationRequested))]
    public void ElevatedHostVerifiesProtectedJobsAndRoundTripsOneIsolatedRule()
    {
        Assert.True(OperatingSystem.IsWindows());
        using var identity = WindowsIdentity.GetCurrent();
        Assert.True(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator), "This opt-in test requires an elevated runner.");
        using var process = Process.GetCurrentProcess();
        var program = Environment.ProcessPath!;
        var started = process.StartTime.ToUniversalTime().Ticks;
        var sid = identity.User!.Value;
        var adapter = DirectNetwork.Read().First(candidate => candidate.Addresses.Any(address =>
            address.Family == "ipv4" && DirectFirewall.AllowedAddress(address.Address)));
        var address = adapter.Addresses.First(candidate => candidate.Family == "ipv4" && DirectFirewall.AllowedAddress(candidate.Address)).Address;
        var grant = new DirectFirewallGrant(Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"),
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)), program, address, "tcp",
            RandomNumberGenerator.GetInt32(49_152, 65_536), adapter.Id, adapter.Name, adapter.Profile);
        var id = DirectFirewall.RuleName(grant);
        Console.WriteLine($"Isolated elevated-host integration rule: {id}; TCP {grant.Address}:{grant.Port}; program {program}");
        // Both roles are this runner so the host can verify real process identity and SID.
        // No TCP listener or other external endpoint is created.
        var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var directories = new List<string>();
        (string Directory, string Path, string Digest) WriteJob(string action)
        {
            var directory = DirectFirewallHost.CreateDirectory(sid); directories.Add(directory);
            var job = new DirectFirewallJob(new(1, "firewall", action, grant, process.Id), started, program,
                process.Id, started, sid, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 120_000);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(job, json);
            var path = Path.Combine(directory, "job.json");
            using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) output.Write(bytes);
            return (directory, path, Convert.ToHexStringLower(SHA256.HashData(bytes)));
        }
        static void AssertResult(string directory)
        {
            var path = Path.Combine(directory, "result.json");
            Assert.True(File.Exists(path), "The elevated host did not produce a result in the protected job directory.");
            var bytes = File.ReadAllBytes(path);
            using var result = JsonDocument.Parse(bytes);
            Assert.Equal(1, result.RootElement.GetProperty("protocolVersion").GetInt32());
            Assert.True(result.RootElement.GetProperty("ok").GetBoolean(), System.Text.Encoding.UTF8.GetString(bytes));
            Assert.False(result.RootElement.TryGetProperty("error", out _));
        }
        using var backend = new CimDirectFirewall();
        var firewall = new DirectFirewall(backend);
        var removedByHost = false;
        Assert.Null(backend.ReadPersistent(id));
        try
        {
            var allow = WriteJob("allow");
            // A valid-looking but incorrect digest must not authorize a mutation or a result write.
            var invalidDigest = (allow.Digest[0] == '0' ? "1" : "0") + allow.Digest[1..];
            DirectFirewallHost.RunElevated(allow.Path, invalidDigest);
            Assert.False(File.Exists(Path.Combine(allow.Directory, "result.json")));
            Assert.Null(backend.ReadPersistent(id)); Assert.Null(backend.ReadActive(id));

            DirectFirewallHost.RunElevated(allow.Path, allow.Digest);
            AssertResult(allow.Directory);
            var persistent = backend.ReadPersistent(id); var active = backend.ReadActive(id);
            Assert.NotNull(persistent); Assert.NotNull(active);
            Assert.True(DirectFirewall.Matches(grant, persistent)); Assert.True(DirectFirewall.Matches(grant, active));
            Assert.True(persistent.Enabled); Assert.True(active.Enabled);

            var remove = WriteJob("remove");
            DirectFirewallHost.RunElevated(remove.Path, remove.Digest);
            AssertResult(remove.Directory);
            Assert.Null(backend.ReadPersistent(id)); Assert.Null(backend.ReadActive(id));
            removedByHost = true;
            Console.WriteLine($"Isolated elevated-host integration rule removed by host: {id}");
        }
        finally
        {
            try
            {
                // Preserve strict ownership checks even if the host could not finish removal.
                if (!removedByHost) firewall.Apply(grant, "remove", () => true);
                Assert.Null(backend.ReadPersistent(id));
            }
            catch (Exception error)
            {
                throw new InvalidOperationException($"Isolated elevated-host rule cleanup could not be confirmed: {id}", error);
            }
            finally
            {
                foreach (var directory in directories) Directory.Delete(directory, true);
            }
        }
    }
}
