using System.Reflection;

// An isolated parent and a synthetic tar child exercise the real extraction
// method without downloading models or attaching the test runner to its job.
if (args[0] == "-xjf")
{
    var marker = Environment.GetEnvironmentVariable("CASMATE_EXTRACTION_TEST_PID")!;
    await File.WriteAllTextAsync(marker + ".writing", Environment.ProcessId.ToString());
    File.Move(marker + ".writing", marker);
    if (Environment.GetEnvironmentVariable("CASMATE_EXTRACTION_TEST_MODE") == "failure")
    {
        await Console.Error.WriteAsync(new string('x', 256 * 1024));
        return 17;
    }
    await Task.Delay(TimeSpan.FromMinutes(1));
    return 0;
}
var assembly = Assembly.LoadFrom(args[0]);
var extract = assembly.GetType("CasMate.SpeechRecognition.Worker.ModelManager", true)!
    .GetMethod("ExtractArchiveAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
using var cancellation = new CancellationTokenSource();
var task = (Task)extract.Invoke(null, ["synthetic.tar.bz2", args[1], cancellation.Token])!;
if (args[2] == "cancel")
{
    // The test sends a line only after observing the child start.
    await Console.In.ReadLineAsync();
    cancellation.Cancel();
}
try { await task; return 0; }
catch (OperationCanceledException) { return 2; }
catch (InvalidDataException) { return 3; }
