param([long]$WindowHandle, [ValidateSet(1, 2)][int]$Button = 1)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HistoryMouse {
  private delegate bool EnumWindow(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static void Click(long handle, int button) {
    IntPtr renderer = IntPtr.Zero;
    EnumChildWindows(new IntPtr(handle), (window, parameter) => {
      var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
      if (name.ToString() == "Chrome_RenderWidgetHostHWND") { renderer = window; return false; }
      return true;
    }, IntPtr.Zero);
    if (renderer == IntPtr.Zero) throw new InvalidOperationException("Renderer mouse target not found");
    var position = new IntPtr((100 << 16) | 100);
    SendMessage(renderer, 0x020B, new IntPtr((button << 16) | (button == 1 ? 0x20 : 0x40)), position);
    SendMessage(renderer, 0x020C, new IntPtr(button << 16), position);
  }
}
'@
[HistoryMouse]::Click($WindowHandle, $Button)
