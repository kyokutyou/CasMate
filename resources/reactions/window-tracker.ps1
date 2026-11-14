$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CasMateOverlayWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  public sealed class Window { public string id; public string title; public string processName; public string className; public uint pid; public int x,y,width,height; public bool minimized; public string label; public string displayName; }
  public delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct MonitorInfo { public int cbSize; public Rect monitor,work; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string device; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct DisplayDevice { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string text; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key; }
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice value, uint flags);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr arg);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  public static string Foreground() { return GetForegroundWindow().ToInt64().ToString(); }
  public static List<Window> Displays() {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var displays = new List<Window>();
    EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,(IntPtr handle,IntPtr hdc,ref Rect rect,IntPtr data) => {
      if(displays.Count >= 16) return false;
      var info=new MonitorInfo(); info.cbSize=Marshal.SizeOf(typeof(MonitorInfo));
      if(!GetMonitorInfo(handle,ref info)) return true;
      var device=new DisplayDevice();device.cb=Marshal.SizeOf(typeof(DisplayDevice));
      if(!EnumDisplayDevices(info.device,0,ref device,1) || String.IsNullOrEmpty(device.id)) return true;
      displays.Add(new Window {id="display:"+device.id,title=device.id,processName="@display",className="@display",pid=0,x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top,minimized=false,displayName=info.device,label="モニター "+info.device+" · "+(rect.Right-rect.Left)+"×"+(rect.Bottom-rect.Top)});
      return true;
    },IntPtr.Zero);
    return displays;
  }
  public static List<Window> List(int excludedPid) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var windows = new List<Window>();
    EnumWindows((hwnd,arg) => {
      if (windows.Count >= 240 || !IsWindowVisible(hwnd)) return true;
      uint pid; GetWindowThreadProcessId(hwnd,out pid); if (pid == excludedPid) return true;
      int cloaked; if (DwmGetWindowAttribute(hwnd,14,out cloaked,4)==0 && cloaked!=0) return true;
      var text = new StringBuilder(1024); if (GetWindowText(hwnd,text,text.Capacity)==0) return true;
      Rect rect; var point = new Point(); if (!GetClientRect(hwnd,out rect) || !ClientToScreen(hwnd,ref point)) return true;
      if (rect.Right < 8 || rect.Bottom < 8) return true;
      var classText = new StringBuilder(256); GetClassName(hwnd,classText,classText.Capacity);
      string processName = ""; try { using (var process = System.Diagnostics.Process.GetProcessById((int)pid)) { processName = process.ProcessName + ".exe"; } } catch { }
      windows.Add(new Window { id=hwnd.ToInt64().ToString(),title=text.ToString(),processName=processName,className=classText.ToString(),pid=pid,x=point.X,y=point.Y,width=rect.Right,height=rect.Bottom,minimized=IsIconic(hwnd) });
      return true;
    },IntPtr.Zero);
    return windows;
  }
}
'@
while ($true) {
  if (-not (Get-Process -Id ([int]$env:CASMATE_OVERLAY_PID) -ErrorAction SilentlyContinue)) { break }
  $snapshot = @{ foreground = [CasMateOverlayWindows]::Foreground(); windows = @([CasMateOverlayWindows]::List([int]$env:CASMATE_OVERLAY_PID)) + @([CasMateOverlayWindows]::Displays()) }
  [Console]::WriteLine(($snapshot | ConvertTo-Json -Compress -Depth 4))
  Start-Sleep -Milliseconds 250
}
