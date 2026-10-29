using System.Runtime.InteropServices;

namespace CasMate.PcStatus.Worker;

internal static unsafe class Native
{
    [DllImport("dxgi.dll")] internal static extern int CreateDXGIFactory1(in Guid iid, out nint factory);
    [DllImport("dxcore.dll")] private static extern int DXCoreCreateAdapterFactory(in Guid iid, out nint factory);
    internal static void Release(nint obj) => ((delegate* unmanaged[Stdcall]<nint, uint>)(*(nint**)obj)[2])(obj);
    internal static List<Adapter> Adapters()
    {
        var result = new List<Adapter>();
        var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        Marshal.ThrowExceptionForHR(CreateDXGIFactory1(iid, out var factory));
        try
        {
            var enumerate = (delegate* unmanaged[Stdcall]<nint, uint, nint*, int>)(*(nint**)factory)[12];
            for (uint index = 0; index < 64; index++)
            {
                nint adapter;
                var hr = enumerate(factory, index, &adapter);
                if (hr == unchecked((int)0x887A0002)) break;
                Marshal.ThrowExceptionForHR(hr);
                try
                {
                    AdapterDesc desc;
                    Marshal.ThrowExceptionForHR(((delegate* unmanaged[Stdcall]<nint, AdapterDesc*, int>)(*(nint**)adapter)[10])(adapter, &desc));
                    if ((desc.Flags & 2) != 0) continue; // Software rendering adapter.
                    var id = $"{desc.LuidHigh:x8}:{desc.LuidLow:x8}";
                    result.Add(new(id, new string(desc.Description), desc.DedicatedVideoMemory, !IsIntegrated(desc.LuidLow, desc.LuidHigh)));
                }
                finally { Release(adapter); }
            }
        }
        finally { Release(factory); }
        return result;
    }
    private static bool IsIntegrated(uint low, uint high)
    {
        // DXGI identifies the adapter and memory. DXCore resolves UMA independently
        // of capacity: an integrated GPU can also reserve dedicated video memory.
        var factoryId = new Guid("78ee5945-c36e-4b13-a669-005dd11c0f06");
        var adapterId = new Guid("f0db4c7f-fe5a-42a2-bd62-f2a6cf6fc83e");
        Marshal.ThrowExceptionForHR(DXCoreCreateAdapterFactory(factoryId, out var factory));
        try
        {
            ulong luid = ((ulong)high << 32) | low; nint adapter;
            Marshal.ThrowExceptionForHR(((delegate* unmanaged[Stdcall]<nint, ulong*, Guid*, nint*, int>)(*(nint**)factory)[4])(factory, &luid, &adapterId, &adapter));
            try
            {
                byte integrated;
                Marshal.ThrowExceptionForHR(((delegate* unmanaged[Stdcall]<nint, uint, nuint, byte*, int>)(*(nint**)adapter)[6])(adapter, 12, 1, &integrated));
                return integrated != 0;
            }
            finally { Release(adapter); }
        }
        finally { Release(factory); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct AdapterDesc
    {
        public fixed char Description[128]; public uint VendorId, DeviceId, SubSysId, Revision;
        public nuint DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow, LuidHigh, Flags;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct MemoryStatus
    {
        public uint Length, Load; public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool Process32FirstW(nint snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool Process32NextW(nint snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetProcessTimes(nint process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("psapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetProcessMemoryInfo(nint process, ref ProcessMemory memory, uint size);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct ProcessEntry
    {
        public uint Size, Usage, Pid; public nuint DefaultHeap; public uint ModuleId, Threads, ParentPid; public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessMemory
    {
        public uint Size, PageFaultCount;
        public nuint PeakWorkingSet, WorkingSet, QuotaPeakPaged, QuotaPaged, QuotaPeakNonPaged, QuotaNonPaged, PageFile, PeakPageFile, PrivateUsage, PrivateWorkingSet;
        public ulong SharedCommit;
    }
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] internal static extern uint PdhOpenQueryW(string? source, nuint data, out nint query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] internal static extern uint PdhAddEnglishCounterW(nint query, string path, nuint data, out nint counter);
    [DllImport("pdh.dll")] internal static extern uint PdhCollectQueryData(nint query);
    [DllImport("pdh.dll")] internal static extern uint PdhCloseQuery(nint query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] internal static extern uint PdhGetFormattedCounterArrayW(nint counter, uint format, ref uint bytes, out uint count, nint buffer);
    [StructLayout(LayoutKind.Sequential)] internal struct CounterItem { public nint Name; public uint Status; public double Value; }
}
internal record Adapter(string Id, string Name, ulong Capacity, bool Dedicated);
