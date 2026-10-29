using System.Text.Json;

namespace CasMate.PcStatus.Worker;

internal static class FontCatalogHost
{
    public static async Task Run()
    {
        var finished = 0;
        try
        {
            ReadRequest(Console.In);
            // The parent keeps stdin open until the reply. Its exit or stop closes
            // the pipe, so even a stalled Windows font call cannot leave an orphan.
            _ = Task.Run(() =>
            {
                try { Console.In.ReadLine(); } catch { }
                if (Interlocked.CompareExchange(ref finished, 2, 0) == 0) Environment.Exit(1);
            });
            var enumeration = Task.Run(InstalledFonts.Read);
            if (await Task.WhenAny(enumeration, Task.Delay(4500)) != enumeration) Environment.Exit(1);
            var fonts = await enumeration;
            if (Interlocked.CompareExchange(ref finished, 1, 0) == 0)
                Console.WriteLine(JsonSerializer.Serialize(new { protocolVersion = 1, fonts }));
        }
        catch
        {
            Interlocked.Exchange(ref finished, 1);
            Environment.ExitCode = 1; // Never send native errors or partial font lists.
        }
    }

    internal static void ReadRequest(TextReader input)
    {
        var text = new System.Text.StringBuilder();
        int character;
        while ((character = input.Read()) != -1 && character != '\n')
        {
            if (text.Length >= 1024) throw new InvalidDataException();
            text.Append((char)character);
        }
        if (character == -1) throw new InvalidDataException();
        using var document = JsonDocument.Parse(text.ToString());
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 2 ||
            !root.TryGetProperty("protocolVersion", out var version) || !version.TryGetInt32(out var number) || number != 1 ||
            !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "fonts")
            throw new InvalidDataException();
    }
}
