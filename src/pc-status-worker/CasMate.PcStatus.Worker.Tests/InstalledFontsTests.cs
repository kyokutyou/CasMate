using System.Globalization;
using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class InstalledFontsTests
{
    [Fact] public void ReadsCopiedLocalizedNamesAndReleasesGdiSessionBeforeReturning()
    {
        var api = new FakeApi { Names = [" メイリオ ", "Arial", "Arial", "   ", "bad\u0001name"] };
        var fonts = InstalledFonts.Read(api);
        Assert.Equal([" メイリオ ", "Arial"], fonts);
        Assert.Equal(["startup", "collection", "count", "families", "name:1", "name:2", "name:3", "name:4", "name:5", "shutdown"], api.Calls);
        Assert.Equal(1, api.Shutdowns);
        Assert.All(api.Languages, language => Assert.Equal(unchecked((ushort)CultureInfo.CurrentUICulture.LCID), language));
        api.Names = ["replaced after shutdown"];
        Assert.Equal([" メイリオ ", "Arial"], fonts);
    }

    [Theory] [InlineData("ja-JP")] [InlineData("en-US")]
    public void MatchesManagedFontFamilyNameCurrentUiLanguage(string culture)
    {
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
            var api = new FakeApi();
            InstalledFonts.Read(api);
            Assert.All(api.Languages, language => Assert.Equal(unchecked((ushort)CultureInfo.CurrentUICulture.LCID), language));
        }
        finally { CultureInfo.CurrentUICulture = previous; }
    }

    [Theory] [InlineData("startup")] [InlineData("collection")] [InlineData("count")]
    [InlineData("families")] [InlineData("name")]
    public void FailedNativeStatusThrowsAndEndsEveryStartedSession(string stage)
    {
        var api = new FakeApi { FailingStage = stage };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(api));
        Assert.Equal(stage == "startup" ? 0 : 1, api.Shutdowns);
        if (stage != "startup") Assert.Equal("shutdown", api.Calls[^1]);
    }

    [Fact] public void NativeExceptionDuringNameReadStillEndsSession()
    {
        var api = new FakeApi { ThrowAtName = true };
        Assert.Throws<IOException>(() => InstalledFonts.Read(api));
        Assert.Equal(1, api.Shutdowns); Assert.Equal("shutdown", api.Calls[^1]);
    }

    [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(16_385)] [InlineData(int.MaxValue)]
    public void InvalidCountFailsBeforeAllocatingOrRequestingFamilyList(int count)
    {
        var api = new FakeApi { CountValue = count };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(api));
        Assert.DoesNotContain("families", api.Calls); Assert.Equal(1, api.Shutdowns);
    }

    [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(3)]
    public void InvalidReturnedFamilyCountNeverReadsUninitializedPointers(int found)
    {
        var api = new FakeApi { FoundValue = found };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(api));
        Assert.DoesNotContain(api.Calls, call => call.StartsWith("name:", StringComparison.Ordinal));
        Assert.Equal(1, api.Shutdowns);
    }

    [Fact] public void SmallerCompleteFamilyListRemainsBounded()
    {
        var api = new FakeApi { CountValue = 3, FoundValue = 2 };
        Assert.Equal(["Arial", "メイリオ"], InstalledFonts.Read(api)); Assert.Equal(1, api.Shutdowns);
    }

    [Theory] [InlineData("token")] [InlineData("collection")] [InlineData("family")]
    public void RefusesSuccessfulStatusWithInvalidNativePointers(string pointer)
    {
        var api = new FakeApi { NullPointer = pointer };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(api));
        Assert.Equal(pointer == "token" ? 0 : 1, api.Shutdowns);
        if (pointer == "family") Assert.DoesNotContain(api.Calls, call => call.StartsWith("name:", StringComparison.Ordinal));
    }

    [Fact] public void RefusesUnterminatedNameAndEmptySuccessfulCatalog()
    {
        var malformed = new FakeApi { Names = [new string('a', InstalledFonts.NameBufferSize)] };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(malformed)); Assert.Equal(1, malformed.Shutdowns);
        var empty = new FakeApi { Names = ["", " \t ", "control\u0001"] };
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Read(empty)); Assert.Equal(1, empty.Shutdowns);
    }

    [Fact] public void ShutdownFailureCannotReturnSuccessfulNames()
    {
        var api = new FakeApi { ThrowAtShutdown = true };
        Assert.Throws<IOException>(() => InstalledFonts.Read(api)); Assert.Equal(1, api.Shutdowns);
    }

    [Fact] public void NormalizationPreservesFamilyNamesAndEnforcesNameBounds()
    {
        var longest = new string('a', 200);
        var names = InstalledFonts.Normalize([" Arial ", "ＭＳ ゴシック", "", "bad\nname", new string('b', 201), longest, "Arial"]);
        Assert.Equal([" Arial ", "Arial", longest, "ＭＳ ゴシック"], names);
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Normalize([]));
    }

    [Fact] public void KeepsLeadingTrailingAndInternalSpacesInValidFamilyNames()
    {
        Assert.Equal(["  Spaced font  ", "A  B", "A B"], InstalledFonts.Normalize(["A B", "A  B", "  Spaced font  "]));
    }

    [Fact] public void NormalizationCapsInputCountAndEscapedUtf8Payload()
    {
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Normalize(Enumerable.Repeat("Arial", InstalledFonts.MaxFonts + 1)));
        var large = Enumerable.Range(0, 5_000).Select(index => $"{index:D5}" + new string('字', 195));
        Assert.Throws<InvalidOperationException>(() => InstalledFonts.Normalize(large));
    }

    [Fact] public void WindowsGdiPlusReturnsOnlyUsableInstalledFamilyNames()
    {
        if (!OperatingSystem.IsWindows()) return;
        var names = InstalledFonts.Read();
        Assert.NotEmpty(names); Assert.True(names.Length <= InstalledFonts.MaxFonts);
        Assert.Equal(names.Order(StringComparer.Ordinal), names);
        Assert.Equal(names.Length, names.Distinct(StringComparer.Ordinal).Count());
        Assert.All(names, name =>
        {
            Assert.InRange(name.Length, 1, 200); Assert.False(string.IsNullOrWhiteSpace(name)); Assert.DoesNotContain(name, char.IsControl);
        });
        var fonts = Environment.GetFolderPath(Environment.SpecialFolder.Fonts);
        if (File.Exists(Path.Combine(fonts, "arial.ttf"))) Assert.Contains("Arial", names);
        if (File.Exists(Path.Combine(fonts, "meiryo.ttc"))) Assert.Contains(names, name => name is "メイリオ" or "Meiryo");
    }

    private sealed class FakeApi : IInstalledFontApi
    {
        public string[] Names = ["Arial", "メイリオ"];
        public string? FailingStage, NullPointer;
        public int? CountValue, FoundValue;
        public bool ThrowAtName, ThrowAtShutdown;
        public int Shutdowns;
        public readonly List<string> Calls = [];
        public readonly List<ushort> Languages = [];
        private int Status(string stage) => FailingStage == stage ? 2 : 0;
        public int Startup(out nuint token) { Calls.Add("startup"); token = NullPointer == "token" ? 0U : 7U; return Status("startup"); }
        public void Shutdown(nuint token)
        {
            Assert.Equal((nuint)7, token); Calls.Add("shutdown"); Shutdowns++;
            if (ThrowAtShutdown) throw new IOException("GDI+ shutdown unavailable");
        }
        public int Collection(out nint collection)
        {
            Calls.Add("collection"); collection = NullPointer == "collection" ? 0 : 9; return Status("collection");
        }
        public int Count(nint collection, out int count)
        {
            Assert.Equal((nint)9, collection); Calls.Add("count"); count = CountValue ?? Names.Length; return Status("count");
        }
        public int Families(nint collection, nint[] families, out int found)
        {
            Assert.Equal((nint)9, collection); Calls.Add("families"); found = FoundValue ?? Names.Length;
            for (var index = 0; index < Math.Min(families.Length, Math.Max(0, found)); index++) families[index] = index + 1;
            if (NullPointer == "family") families[0] = 0;
            return Status("families");
        }
        public int Name(nint family, char[] name, ushort language)
        {
            Calls.Add($"name:{family}"); Languages.Add(language); Assert.Equal(InstalledFonts.NameBufferSize, name.Length);
            if (ThrowAtName) throw new IOException("GDI+ family unavailable");
            Names[(int)family - 1].AsSpan().CopyTo(name);
            return Status("name");
        }
    }
}
