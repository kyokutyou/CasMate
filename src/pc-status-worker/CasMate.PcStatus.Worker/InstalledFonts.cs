using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace CasMate.PcStatus.Worker;

internal interface IInstalledFontApi
{
    int Startup(out nuint token);
    void Shutdown(nuint token);
    int Collection(out nint collection);
    int Count(nint collection, out int count);
    int Families(nint collection, nint[] families, out int found);
    int Name(nint family, char[] name, ushort language);
}

internal static class InstalledFonts
{
    internal const int MaxFonts = 16_384, NameBufferSize = 32, MaxPayloadBytes = 1_048_576;

    public static string[] Read()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        return Read(new GdiFontApi());
    }

    internal static string[] Read(IInstalledFontApi api)
    {
        RequireOk(api.Startup(out var token));
        if (token == 0) throw new InvalidOperationException("Invalid GDI+ startup token");
        try
        {
            RequireOk(api.Collection(out var collection));
            if (collection == 0) throw new InvalidOperationException("Invalid installed font collection");
            RequireOk(api.Count(collection, out var count));
            if (count is < 1 or > MaxFonts) throw new InvalidOperationException("Invalid installed font count");
            var families = new nint[count];
            RequireOk(api.Families(collection, families, out var found));
            if (found < 1 || found > count) throw new InvalidOperationException("Invalid installed font list");
            var names = new List<string>(found);
            var buffer = new char[NameBufferSize];
            // Preserve System.Drawing.FontFamily.Name's CurrentUICulture language,
            // including LANGID's 16-bit conversion used by the managed wrapper.
            var language = unchecked((ushort)CultureInfo.CurrentUICulture.LCID);
            for (var index = 0; index < found; index++)
            {
                if (families[index] == 0) throw new InvalidOperationException("Invalid installed font family");
                Array.Clear(buffer);
                RequireOk(api.Name(families[index], buffer, language));
                var length = Array.IndexOf(buffer, '\0');
                if (length < 0) throw new InvalidOperationException("Invalid installed font name");
                names.Add(new string(buffer, 0, length));
            }
            return Normalize(names);
        }
        finally
        {
            // Installed collections and listed families are borrowed GDI+ singletons,
            // not private collections or owned FontFamily clones. Do not delete them.
            // Release the GDI+ session only after all names have been copied.
            api.Shutdown(token);
        }
    }

    internal static string[] Normalize(IEnumerable<string> values)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        var count = 0;
        foreach (var value in values)
        {
            if (++count > MaxFonts) throw new InvalidOperationException("Too many installed fonts");
            // Whitespace-only names are unusable; valid names retain their original
            // spacing just like the previous InstalledFontCollection.Name response.
            if (!string.IsNullOrWhiteSpace(value) && value.Length <= 200 && !value.Any(char.IsControl)) names.Add(value);
        }
        if (names.Count == 0) throw new InvalidOperationException("No installed fonts available");
        var result = names.ToArray();
        // Leave room for the host's protocolVersion/fonts envelope and newline.
        if (JsonSerializer.SerializeToUtf8Bytes(result).Length > MaxPayloadBytes - 64)
            throw new InvalidOperationException("Installed font response exceeds limit");
        return result;
    }

    private static void RequireOk(int status)
    {
        if (status != 0) throw new InvalidOperationException("Installed font enumeration failed");
    }

    private sealed unsafe class GdiFontApi : IInstalledFontApi
    {
        public int Startup(out nuint token)
        {
            var input = new StartupInput { Version = 1 };
            return GdiplusStartup(out token, ref input, 0);
        }
        public void Shutdown(nuint token) => GdiplusShutdown(token);
        public int Collection(out nint collection) => GdipNewInstalledFontCollection(out collection);
        public int Count(nint collection, out int count) => GdipGetFontCollectionFamilyCount(collection, out count);
        public int Families(nint collection, nint[] families, out int found)
        {
            fixed (nint* buffer = families) return GdipGetFontCollectionFamilyList(collection, families.Length, buffer, out found);
        }
        public int Name(nint family, char[] name, ushort language)
        {
            fixed (char* buffer = name) return GdipGetFamilyName(family, buffer, language);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInput
    {
        public uint Version;
        public nint DebugCallback;
        public int SuppressBackgroundThread, SuppressExternalCodecs;
    }
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern int GdiplusStartup(out nuint token, ref StartupInput input, nint output);
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern void GdiplusShutdown(nuint token);
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern int GdipNewInstalledFontCollection(out nint collection);
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern int GdipGetFontCollectionFamilyCount(nint collection, out int count);
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern unsafe int GdipGetFontCollectionFamilyList(nint collection, int sought, nint* families, out int found);
    [DllImport("gdiplus.dll", ExactSpelling = true)]
    private static extern unsafe int GdipGetFamilyName(nint family, char* name, ushort language);
}
