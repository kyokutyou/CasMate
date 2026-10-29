using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CasMate.SpeechRecognition.Worker;

internal static class WorkerProcessJob
{
    private static SafeFileHandle? _workerJob;
    private static readonly object Gate = new();

    // Assign the worker before launching children: even a kill between Start and child bookkeeping is safe.
    // This handle deliberately lasts until worker process exit, when Windows kills all remaining members.
    public static void EnsureChildOwnership()
    {
        if (!OperatingSystem.IsWindows()) return;
        lock (Gate)
        {
            if (_workerJob is not null) return;
            var job = Create();
            if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
            {
                job.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            _workerJob = job;
        }
    }

    internal static SafeFileHandle Create()
    {
        var job = CreateJobObjectW(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits { Basic = new BasicLimits { LimitFlags = 0x2000 } };
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()))
        {
            job.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        return job;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int informationClass, ref ExtendedLimits information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
}
