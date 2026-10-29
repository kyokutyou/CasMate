using System.Text.Json;

namespace CasMate.PcStatus.Worker;

// Optional protected lookup locations, never ownership or absence evidence.
internal sealed class DirectFirewallPathHints
{
    internal sealed record Entry(DirectFirewallGrant Grant, string Path);
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private bool changed;

    internal string? For(DirectFirewallGrant grant) => entries.TryGetValue(grant.Id, out var entry) && entry.Grant == grant ? entry.Path : null;

    internal void Remember(DirectFirewallGrant grant, string? path)
    {
        if (path is null || !CimDirectFirewall.IsStandardPath(DirectFirewall.RuleName(grant), path)) return;
        var next = new Entry(grant, path);
        if (entries.TryGetValue(grant.Id, out var old) && old == next) return;
        if (!entries.ContainsKey(grant.Id) && entries.Count >= 4096) return;
        entries[grant.Id] = next; changed = true;
    }
    internal void Remove(string id) { if (entries.Remove(id)) changed = true; }

    internal static DirectFirewallPathHints Load(string path)
    {
        var hints = new DirectFirewallPathHints();
        try
        {
            if (!File.Exists(path)) return hints;
            DirectFirewallHost.RejectReparsePoints(path);
            using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (input.Length > 16 * 1024 * 1024) return hints;
            var saved = JsonSerializer.Deserialize<Entry[]>(input, DirectFirewallService.Json);
            if (saved is null || saved.Length > 4096) return hints;
            foreach (var entry in saved)
            {
                if (entry?.Grant is null || entry.Path is null) continue;
                DirectFirewall.Validate(entry.Grant, "remove");
                hints.Remember(entry.Grant, entry.Path);
            }
            hints.changed = false;
            return hints;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or DirectFirewallException)
        {
            // Missing/broken hints cannot prevent the authoritative ownership search and cleanup.
            return new();
        }
    }

    internal bool Save(string path, IEnumerable<DirectFirewallGrant> owned)
    {
        var current = owned.ToDictionary(grant => grant.Id, StringComparer.Ordinal);
        foreach (var entry in entries.Values.ToArray())
            if (!current.TryGetValue(entry.Grant.Id, out var grant) || grant != entry.Grant) Remove(entry.Grant.Id);
        if (!changed) return true;
        try { DirectFirewallServiceSetup.WriteJson(path, entries.Values.ToArray()); changed = false; return true; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or DirectFirewallException) { return false; }
    }
}
