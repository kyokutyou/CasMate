using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;

namespace CasMate.SpeechRecognition.Worker;

internal static partial class RecognitionResultText
{
    private const string NumericSuffixes = "年月日時分秒円人名個本枚台匹頭羽冊回階件軒杯曲着足箱袋組番号話点歳才度割倍パペキグセミ";
    private const string NumericCompoundContinuations = "間半頃前後中組立目上下内外未満以上以内程度";

    [GeneratedRegex("[〇零一二三四五六七八九十百千万億兆]+")]
    private static partial Regex JapaneseNumeralPattern();

    [GeneratedRegex("(?<whole>[0-9〇零一二三四五六七八九十百千万億兆]+)(?:．|点|てん)(?<fraction>[0-9〇零一二三四五六七八九十百千万億兆]+)")]
    private static partial Regex SpokenDecimalPattern();

    [GeneratedRegex("(?<=電話番号は)[1-9][0-9]*")]
    private static partial Regex DomesticPhoneNumberWithoutLeadingZeroPattern();

    public static string Normalize(string text)
    {
        var decimalsNormalized = SpokenDecimalPattern().Replace(text, match =>
            $"{NormalizeDecimalPart(match.Groups["whole"].Value)}.{NormalizeDecimalPart(match.Groups["fraction"].Value)}");

        var numeralsNormalized = JapaneseNumeralPattern().Replace(decimalsNormalized, match =>
        {
            var nextIndex = match.Index + match.Length;
            if (IsProtectedOrdinaryNumeral(match)) return match.Value;
            if (IsStandaloneNumber(decimalsNormalized, match, nextIndex)) return ToArabicDigits(match.Value);
            if (!HasNumericSuffixContext(decimalsNormalized, nextIndex)) return match.Value;
            if (IsOrdinaryWordUse(decimalsNormalized, match, nextIndex)) return match.Value;
            return ToArabicDigits(match.Value);
        });
        return DomesticPhoneNumberWithoutLeadingZeroPattern().Replace(
            numeralsNormalized,
            match => $"0{match.Value}");
    }

    private static string NormalizeDecimalPart(string value) =>
        JapaneseNumeralPattern().Replace(value, match => ToArabicDigits(match.Value));

    private static bool IsStandaloneNumber(string text, Match match, int nextIndex)
    {
        var hasNumericLeftContext = match.Index == 0 || "はがをにでと第".Contains(text[match.Index - 1]);
        if (!hasNumericLeftContext) return false;
        if (nextIndex >= text.Length) return true;
        var following = text.AsSpan(nextIndex);
        return following.StartsWith("です") || following.StartsWith("でした") ||
            following[0] is 'だ' or '、' or '。' or '！' or '？' or ',' or '.' or '!' or '?';
    }

    private static bool HasNumericSuffixContext(string text, int suffixIndex)
    {
        if (suffixIndex >= text.Length || !NumericSuffixes.Contains(text[suffixIndex])) return false;
        var followingIndex = suffixIndex + 1;
        if (followingIndex >= text.Length) return true;
        var followingNumber = JapaneseNumeralPattern().Match(text, followingIndex);
        if (followingNumber.Success && followingNumber.Index == followingIndex) return true;
        return !IsCjkIdeograph(text[followingIndex]) || NumericCompoundContinuations.Contains(text[followingIndex]);
    }

    private static bool IsOrdinaryWordUse(string text, Match match, int suffixIndex)
    {
        if (match.Value == "四六" && text.AsSpan(suffixIndex).StartsWith("時中")) return true;
        if (match.Value != "十" || text[suffixIndex] != '分') return false;
        var followingIndex = suffixIndex + 1;
        return followingIndex >= text.Length || text[followingIndex] is 'な' or 'に' or 'だ' or 'で' or 'の';
    }

    private static bool IsProtectedOrdinaryNumeral(Match match) => match.Value == "万一";

    private static bool IsCjkIdeograph(char value) =>
        value is >= '\u3400' and <= '\u4DBF' or >= '\u4E00' and <= '\u9FFF' or >= '\uF900' and <= '\uFAFF';

    private static string ToArabicDigits(string value)
    {
        if (!value.Any(IsUnit))
        {
            var digits = new StringBuilder(value.Length);
            foreach (var character in value) digits.Append(DigitValue(character));
            return digits.ToString();
        }

        var leadingZeroes = value.TakeWhile(character => character is '〇' or '零').Count();
        BigInteger total = 0;
        BigInteger section = 0;
        var digit = 0;
        foreach (var character in value)
        {
            if (TryDigitValue(character, out var nextDigit))
            {
                digit = nextDigit;
                continue;
            }

            var unit = UnitValue(character);
            if (unit < 10_000)
            {
                section += (digit == 0 ? 1 : digit) * unit;
            }
            else
            {
                section += digit;
                total += (section == 0 ? 1 : section) * unit;
                section = 0;
            }
            digit = 0;
        }

        return new string('0', leadingZeroes) + (total + section + digit);
    }

    private static bool IsUnit(char value) => value is '十' or '百' or '千' or '万' or '億' or '兆';

    private static int DigitValue(char value) => TryDigitValue(value, out var digit)
        ? digit
        : throw new ArgumentOutOfRangeException(nameof(value));

    private static bool TryDigitValue(char value, out int digit)
    {
        digit = value switch
        {
            '〇' or '零' => 0,
            '一' => 1,
            '二' => 2,
            '三' => 3,
            '四' => 4,
            '五' => 5,
            '六' => 6,
            '七' => 7,
            '八' => 8,
            '九' => 9,
            _ => -1,
        };
        return digit >= 0;
    }

    private static BigInteger UnitValue(char value) => value switch
    {
        '十' => 10,
        '百' => 100,
        '千' => 1_000,
        '万' => 10_000,
        '億' => 100_000_000,
        '兆' => BigInteger.Parse("1000000000000"),
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
}
