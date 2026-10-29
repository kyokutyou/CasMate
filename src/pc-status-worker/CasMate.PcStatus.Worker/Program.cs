using System.Text;
using System.Text.Json;
using CasMate.PcStatus.Worker;

if (args.Length == 2 && args[0] == "--direct-firewall-service") { WindowsFirewallServiceHost.Run(args[1]); return; }
if (args.Length == 2 && args[0] == "--direct-firewall-uninstall-elevated") { Environment.ExitCode = DirectFirewallServiceSetup.Uninstall(args[1], true); return; }
if (args.Length == 1 && args[0] == "--direct-firewall-uninstall")
{
    var id = DirectFirewallService.Identity(System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value);
    Environment.ExitCode = DirectFirewallServiceSetup.Uninstall(id, false); return;
}
Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
if (args.Length == 1 && args[0] == "--font-catalog") { await FontCatalogHost.Run(); return; }
if (args.Length == 1 && args[0] == "--direct-firewall") { await DirectFirewallHost.Run(); return; }
if (args.Length == 2 && args[0] == "--direct-firewall-provider") { await DirectFirewallIsolation.Provider(args[1]); return; }
if (args.Length == 3 && args[0] == "--direct-firewall-elevated") { DirectFirewallHost.RunElevated(args[1], args[2]); return; }
if (args.Length == 1 && args[0] is "--direct-network" or "--lan-network")
{
    while (Console.ReadLine() is { } networkLine)
    {
        if (networkLine.Length > 1024) break;
        try
        {
            var request = JsonSerializer.Deserialize<NetworkRequest>(networkLine, json);
            if (request is null || request.ProtocolVersion != 1 || request.Type != "adapters" || request.Id < 1) break;
            Console.WriteLine(JsonSerializer.Serialize(new { protocolVersion = 1, request.Id, adapters = DirectNetwork.Read(args[0] == "--lan-network") }, json));
        }
        catch { break; }
    }
    return;
}
using var sampler = new Sampler();
while (Console.ReadLine() is { } line)
{
    if (line.Length > 128_000) break;
    try
    {
        var request = JsonSerializer.Deserialize<Request>(line, json);
        if (request is null || request.ProtocolVersion != 1 || request.Type != "sample" || request.Roots.Length > 2048) break;
        var sample = sampler.Sample(request.Roots);
        Console.WriteLine(JsonSerializer.Serialize(new { protocolVersion = 1, request.Id, sample }, json));
    }
    catch { break; } // Parent supervises protocol failure; never emit native details.
}
internal record Request(int ProtocolVersion, string Type, int Id, ProcessRoot[] Roots);
internal record NetworkRequest(int ProtocolVersion, string Type, int Id);
