using CasMate.SpeechRecognition.Worker;
using Xunit;

namespace CasMate.SpeechRecognition.Worker.Tests;

public sealed class RecognitionResultTextTests
{
    [Fact]
    public void ConvertsJapaneseNumeralsInADateToArabicDigits()
    {
        Assert.Equal("8月30日", RecognitionResultText.Normalize("八月三十日"));
    }

    [Fact]
    public void PreservesOrdinaryWordsThatContainNumeralCharacters()
    {
        Assert.Equal(
            "万一に備え、四六時中、一緒に一般的で十分な準備をして五十歩百歩を避ける",
            RecognitionResultText.Normalize("万一に備え、四六時中、一緒に一般的で十分な準備をして五十歩百歩を避ける"));
    }

    [Theory]
    [InlineData("万一です")]
    [InlineData("万一だ")]
    public void PreservesAnOrdinaryNumeralWordAtTheEndOfASentence(string recognizedText)
    {
        Assert.Equal(recognizedText, RecognitionResultText.Normalize(recognizedText));
    }

    [Fact]
    public void ConvertsJapaneseNumeralsBeforeCounters()
    {
        Assert.Equal("3人で2本ずつ", RecognitionResultText.Normalize("三人で二本ずつ"));
    }

    [Theory]
    [InlineData("三時間", "3時間")]
    [InlineData("三時半", "3時半")]
    [InlineData("三人組", "3人組")]
    [InlineData("二本立て", "2本立て")]
    [InlineData("三台目", "3台目")]
    public void ConvertsJapaneseNumeralsBeforeCompoundCounters(string recognizedText, string expected)
    {
        Assert.Equal(expected, RecognitionResultText.Normalize(recognizedText));
    }

    [Fact]
    public void ConvertsASequenceOfSpokenDigitsWithoutDroppingLeadingZeroes()
    {
        Assert.Equal("電話番号は090です", RecognitionResultText.Normalize("電話番号は〇九〇です"));
    }

    [Fact]
    public void ConvertsAnUnadornedMultiCharacterNumber()
    {
        Assert.Equal("答えは123です", RecognitionResultText.Normalize("答えは百二十三です"));
    }

    [Fact]
    public void ConvertsAStandaloneSingleDigitAfterAParticle()
    {
        Assert.Equal("答えは3です", RecognitionResultText.Normalize("答えは三です"));
    }

    [Fact]
    public void ConvertsJapaneseNumeralsBeforeAUnitWrittenInKatakana()
    {
        Assert.Equal("3パーセント", RecognitionResultText.Normalize("三パーセント"));
    }

    [Fact]
    public void PreservesAnExplicitLeadingZeroInASpokenDigitSequence()
    {
        Assert.Equal("電話番号は090です", RecognitionResultText.Normalize("電話番号は零九十です"));
    }

    [Fact]
    public void PreservesMultipleLeadingZeroesWithoutPhoneNumberContext()
    {
        Assert.Equal("0086", RecognitionResultText.Normalize("零零八六"));
    }

    [Fact]
    public void RestoresTheLeadingZeroOmittedFromADomesticPhoneNumber()
    {
        Assert.Equal("電話番号は090です", RecognitionResultText.Normalize("電話番号は九十です"));
    }

    [Theory]
    [InlineData("三．一四")]
    [InlineData("三点一四")]
    [InlineData("三てん十四")]
    [InlineData("3てん14")]
    public void ConvertsASpokenDecimalToArabicNotation(string recognizedNumber)
    {
        Assert.Equal("円周率は3.14です", RecognitionResultText.Normalize($"円周率は{recognizedNumber}です"));
    }

    [Fact]
    public void ConvertsAFullWidthDecimalWithAnAlreadyArabicFraction()
    {
        Assert.Equal("円周率は3.14です", RecognitionResultText.Normalize("円周率は三．14です"));
    }

    [Fact]
    public void ConvertsAPlaceValueExpressionInTheFractionalPart()
    {
        Assert.Equal("円周率は3.14です", RecognitionResultText.Normalize("円周率は三．十四です"));
    }
}
