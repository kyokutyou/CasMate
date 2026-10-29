using Xunit;

namespace CasMate.PcStatus.Worker.Tests;

public class FontCatalogHostTests
{
    [Fact] public void AcceptsOnlyTheFontRequestWithVersionOne()
    {
        FontCatalogHost.ReadRequest(new StringReader("{\"protocolVersion\":1,\"type\":\"fonts\"}\n"));
        FontCatalogHost.ReadRequest(new StringReader("{\"type\":\"fonts\",\"protocolVersion\":1}\r\n"));
    }
    [Theory]
    [InlineData("")]
    [InlineData("{\"protocolVersion\":1,\"type\":\"fonts\"}")]
    [InlineData("{\"protocolVersion\":2,\"type\":\"fonts\"}\n")]
    [InlineData("{\"protocolVersion\":1,\"type\":\"sample\"}\n")]
    [InlineData("{\"protocolVersion\":1,\"type\":\"fonts\",\"path\":\"C:\\\\Fonts\"}\n")]
    [InlineData("{\"protocolVersion\":1,\"protocolVersion\":1,\"type\":\"fonts\"}\n")]
    [InlineData("{\"protocolVersion\":\"1\",\"type\":\"fonts\"}\n")]
    [InlineData("{\"protocolVersion\":1}\n")]
    [InlineData("[1,\"fonts\"]\n")]
    public void RejectsIncompleteUnsupportedOrExpandedRequests(string line) =>
        Assert.ThrowsAny<Exception>(() => FontCatalogHost.ReadRequest(new StringReader(line)));

    [Fact] public void RejectsOverlongRequestsBeforeFontEnumeration() =>
        Assert.Throws<InvalidDataException>(() => FontCatalogHost.ReadRequest(new StringReader(new string(' ', 1025) + "\n")));
}
