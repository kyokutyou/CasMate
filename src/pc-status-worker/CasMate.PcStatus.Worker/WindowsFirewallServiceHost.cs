using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;

// Minimal SCM adapter; no shell, generated scripts or additional service runtime package.
internal static class WindowsFirewallServiceHost
{
    [StructLayout(LayoutKind.Sequential)] private struct Status
    {
        public uint Type, State, Accepted, Win32Exit, SpecificExit, Checkpoint, WaitHint, Pid, Flags;
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void ServiceMain(uint argc, nint argv);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate uint Control(uint control, uint eventType, nint eventData, nint context);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Entry
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string? Name;
        public ServiceMain? Main;
    }

    internal static void Run(string id)
    {
        using var stop = new CancellationTokenSource();
        nint handle = 0;
        void Report(uint state, uint exit = 0)
        {
            var status = new Status { Type = 0x10, State = state, Accepted = state == 4 ? 1u : 0, Win32Exit = exit, WaitHint = state is 2 or 3 ? 10_000u : 0 };
            SetServiceStatus(handle, ref status);
        }
        Control control = (code, _, _, _) => { if (code == 1) { Report(3); stop.Cancel(); } return 0; };
        ServiceMain main = (_, _) =>
        {
            handle = RegisterServiceCtrlHandlerExW(DirectFirewallService.Name(id), control, 0);
            if (handle == 0) return;
            Report(2);
            try
            {
                Report(4);
                DirectFirewallService.Serve(id, stop.Token).GetAwaiter().GetResult();
                Report(1);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { Report(1); }
            catch { Report(1, 1066); }
        };
        if (!StartServiceCtrlDispatcherW([new() { Name = DirectFirewallService.Name(id), Main = main }, new()]))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        GC.KeepAlive(main); GC.KeepAlive(control);
    }

    private static Status Query(string name)
    {
        var manager = OpenSCManagerW(null, null, 1);
        if (manager == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var service = OpenServiceW(manager, name, 4);
            if (service == 0)
            {
                var error = Marshal.GetLastWin32Error();
                if (error == 1060) return new();
                throw new Win32Exception(error);
            }
            try
            {
                if (!QueryServiceStatusEx(service, 0, out var status, Marshal.SizeOf<Status>(), out _)) throw new Win32Exception(Marshal.GetLastWin32Error());
                return status;
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }
    internal static uint State(string name) => Query(name).State;
    internal static uint ProcessId(string name) => Query(name).Pid;
    internal static void StartInstalled(string name)
    {
        var state = State(name);
        if (state == 0) throw new DirectFirewallException("failed");
        if (state == 1) Sc(["start", name], 1056);
        var deadline = Environment.TickCount64 + 5_000;
        while ((state = State(name)) is 2 or 3 && Environment.TickCount64 < deadline) Thread.Sleep(50);
        if (state != 4) throw new DirectFirewallException("failed");
    }
    internal static void Stop(string name)
    {
        if (State(name) == 0) return;
        Sc(["stop", name], 1062);
        var deadline = Environment.TickCount64 + 10_000;
        while (State(name) != 1 && Environment.TickCount64 < deadline) Thread.Sleep(50);
        if (State(name) != 1) throw new DirectFirewallException("failed");
    }
    internal static void Register(string name, string executable, string id, string sid)
    {
        // Quoted executable and fixed option; id is derived from SHA-256, never arbitrary arguments.
        var binary = $"\"{executable}\" --direct-firewall-service {id}";
        if (State(name) == 0) Sc(["create", name, "binPath=", binary, "start=", "auto", "obj=", "LocalSystem", "DisplayName=", "CasMate 直接接続の受信許可"]);
        else Sc(["config", name, "binPath=", binary, "start=", "auto", "obj=", "LocalSystem"]);
        // User may query and start, but cannot reconfigure, stop, delete or change the ACL.
        Sc(["sdset", name, $"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;LCRP;;;{sid})"]);
        Sc(["failure", name, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/60000"]);
        StartInstalled(name);
    }
    internal static void Delete(string name) { if (State(name) != 0) Sc(["delete", name]); }
    private static void Sc(string[] args, params int[] accepted)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe"))
        { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new DirectFirewallException("failed");
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(15_000)) { process.Kill(); throw new DirectFirewallException("failed"); }
        Task.WaitAll(stdout, stderr);
        if (process.ExitCode != 0 && !accepted.Contains(process.ExitCode)) throw new DirectFirewallException("failed");
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartServiceCtrlDispatcherW([In] Entry[] entries);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint RegisterServiceCtrlHandlerExW(string name, Control handler, nint context);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetServiceStatus(nint service, ref Status status);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint OpenSCManagerW(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint OpenServiceW(nint manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(nint service, int level, out Status status, int size, out int needed);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(nint service);
}
