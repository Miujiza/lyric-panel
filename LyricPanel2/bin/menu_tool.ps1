# Drives Premiere's native menu bar.
#   -Mode dump                         -> prints every menu item as "Path>To>Item<TAB>id<TAB>state"
#   -Mode invoke -Items "A|B>C" [-DelayMs 500]
#        each spec is matched against the END of an item's path ("Edit>Select All" or just "Select All");
#        first match wins; items are fired in order with a delay between them.
param([string]$Mode = "dump", [string]$Items = "", [int]$DelayMs = 500)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LPWin {
    [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr hMenu);
    [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr hMenu, int pos);
    [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr hMenu, int pos);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr hMenu, uint id, StringBuilder s, int max, uint flags);
    [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr hMenu, uint pos, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$p = Get-Process | Where-Object { $_.ProcessName -like "Adobe Premiere Pro*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "ERROR`tPremiere window not found"; exit 1 }
$hwnd = $p.MainWindowHandle
$menu = [LPWin]::GetMenu($hwnd)
if ($menu -eq [IntPtr]::Zero) { Write-Output "ERROR`tno native menu"; exit 2 }

function Get-Text($m, $pos) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][LPWin]::GetMenuString($m, [uint32]$pos, $sb, 512, 0x400)
    ($sb.ToString() -replace '&', '') -replace "\t.*$", ''
}

# Ask Premiere to refresh a submenu (items/enabled state are filled in lazily).
function Refresh($sub, $pos) { [void][LPWin]::SendMessage($hwnd, 0x117, $sub, [IntPtr]$pos) }  # WM_INITMENUPOPUP

# Fire a known command id without touching the menus at all.
if ($Mode -eq "id") {
    $fg = [LPWin]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [void][LPWin]::PostMessage($hwnd, 0x111, [IntPtr][int]$Items, [IntPtr]::Zero)
    Write-Output "FIRED`tid`t$Items"
    Write-Output "FOREGROUND`t$fg"
    exit 0
}

# Type real keystrokes into Premiere (SendKeys syntax: + shift, ^ ctrl), e.g. "+3" focuses the timeline.
if ($Mode -eq "keys") {
    Add-Type -AssemblyName System.Windows.Forms
    $fg = [LPWin]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait($Items)
    Write-Output "KEYS`t$Items`t$fg"
    exit 0
}

$all = New-Object System.Collections.ArrayList
function Walk($m, $path, $depth) {
    $n = [LPWin]::GetMenuItemCount($m)
    for ($i = 0; $i -lt $n; $i++) {
        $t = Get-Text $m $i
        if ($t -eq "") { continue }
        $sub = [LPWin]::GetSubMenu($m, $i)
        $full = if ($path) { "$path>$t" } else { $t }
        if ($sub -ne [IntPtr]::Zero) {
            if ($depth -lt 4) { Refresh $sub $i; Walk $sub $full ($depth + 1) }
        } else {
            $state = [LPWin]::GetMenuState($m, [uint32]$i, 0x400)
            $grey = (($state -band 0x3) -ne 0)
            [void]$all.Add([pscustomobject]@{ Path = $full; Id = [LPWin]::GetMenuItemID($m, $i); Grey = $grey })
        }
    }
}
Walk $menu "" 0

if ($Mode -eq "dump") {
    foreach ($a in $all) { Write-Output ("{0}`t{1}`t{2}" -f $a.Path, $a.Id, $(if ($a.Grey) { "grey" } else { "on" })) }
    exit 0
}

$first = $true
foreach ($spec in ($Items -split '\|')) {
    $spec = $spec.Trim()
    if ($spec -eq "") { continue }
    if (-not $first) { Start-Sleep -Milliseconds $DelayMs }
    $first = $false
    # re-read so enabled state reflects the previous command
    $all.Clear(); Walk $menu "" 0
    $hit = $all | Where-Object { $_.Path -eq $spec -or $_.Path.EndsWith(">" + $spec) } | Select-Object -First 1
    if (-not $hit) { Write-Output "MISSING`t$spec"; continue }
    [void][LPWin]::PostMessage($hwnd, 0x111, [IntPtr][int]$hit.Id, [IntPtr]::Zero)  # WM_COMMAND
    Write-Output ("FIRED`t{0}`t{1}`t{2}" -f $hit.Path, $hit.Id, $(if ($hit.Grey) { "grey" } else { "on" }))
}
