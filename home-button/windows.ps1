# Glass Home - Home button helper for Fire TV (Windows)
#
# Fire TV only lets a computer give Glass Home the Home button, once. This does it:
#   1. gets Android's adb tool from Google if this PC doesn't have it (into %LOCALAPPDATA%\GlassHome)
#   2. finds the TVs with Glass Home on this Wi-Fi
#   3. connects (the TV asks to allow this computer: choose Always allow -> OK)
#   4. turns on Glass Home's Home-button service and lets it switch itself back on if Fire TV stops it
# Nothing else on the TV is changed. Afterwards ADB debugging can be turned off again.
#
# Run it: double-click GlassHome-HomeButton-Windows.bat, or in PowerShell:
#   irm <page>/home-button/windows.ps1 | iex
# Works in Windows PowerShell 5.1 (built into Windows 10/11) and PowerShell 7.
# Testing: $env:GLASS_ADB = path to adb, $env:GLASS_TV = the TV's address (skips the search).

$ErrorActionPreference = 'Continue'
$PKG = 'com.bavahar.glass'
$ME = "$PKG/$PKG.HomeWatcher"
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function Line($t) { Write-Host ''; Write-Host $t }
function Finish($code) { Write-Host ''; [void](Read-Host 'Press Enter to close'); exit $code }

Write-Host 'Glass Home - Home button helper (Fire TV)'
Write-Host '========================================='

# ------------------------------------------------------------------ 1. adb
$ADB = $env:GLASS_ADB
if (-not $ADB) {
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { $ADB = $onPath.Path }
    else {
        $base = $env:LOCALAPPDATA
        if (-not $base) { $base = [IO.Path]::GetTempPath() }
        $dir = Join-Path $base 'GlassHome'
        $ADB = Join-Path $dir 'platform-tools\adb.exe'
        if (-not (Test-Path $ADB)) {
            Line "Getting Android's adb tool from Google (about 10 MB, once)..."
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            $zip = Join-Path $dir 'platform-tools.zip'
            try { Invoke-WebRequest -UseBasicParsing -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip }
            catch { Line "Couldn't download it. Check the internet connection and try again."; Finish 1 }
            Expand-Archive -Force -Path $zip -DestinationPath $dir
            Remove-Item $zip -ErrorAction SilentlyContinue
            if (-not (Test-Path $ADB)) { Line "The download didn't contain adb. Try again later."; Finish 1 }
        }
    }
}
function Adb { & $ADB @args 2>&1 | ForEach-Object { "$_" } }
function TvShell([string]$cmd) { ((& $ADB -s "${script:TV}:5555" shell $cmd 2>$null) -join "`n").Replace("`r", '') }

# ------------------------------------------------------------------ 2. which TV
$script:TV = $env:GLASS_TV
if ($args.Count -gt 0) { $script:TV = "$($args[0])" }
if (-not $script:TV) {
    # this computer's address on the home network
    $mine = $null
    foreach ($ni in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback') { continue }
        foreach ($u in $ni.GetIPProperties().UnicastAddresses) {
            $ip = $u.Address.ToString()
            if ($u.Address.AddressFamily -eq 'InterNetwork' -and $ip -notlike '169.254.*' -and $ip -ne '127.0.0.1') {
                if ($ni.GetIPProperties().GatewayAddresses.Count -gt 0 -or -not $mine) { $mine = $ip }
            }
        }
    }
    $found = @()
    if ($mine) {
        $net = $mine.Substring(0, $mine.LastIndexOf('.'))
        Line "Looking for Glass Home on this Wi-Fi ($net.x)..."
        # knock on port 8766 everywhere at once, then ask the ones that answered who they are
        $tries = @()
        foreach ($i in 1..254) {
            $c = New-Object Net.Sockets.TcpClient
            $tries += [pscustomobject]@{ Ip = "$net.$i"; Client = $c; Task = $c.ConnectAsync("$net.$i", 8766) }
        }
        Start-Sleep -Milliseconds 1500
        foreach ($t in $tries) {
            $open = $t.Task.IsCompleted -and -not $t.Task.IsFaulted -and $t.Client.Connected
            $t.Client.Close()
            if (-not $open) { continue }
            try {
                $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://$($t.Ip):8766/ping"
                if ($r.Content -like '*glasshome*') {
                    $j = $r.Content | ConvertFrom-Json
                    $found += [pscustomobject]@{ Ip = $t.Ip; Name = $j.name }
                }
            } catch { }
        }
    }
    if ($found.Count -eq 1) {
        $script:TV = $found[0].Ip
        Write-Host "Found: $($found[0].Name) at $($script:TV)"
    } elseif ($found.Count -gt 1) {
        Write-Host 'Found these TVs with Glass Home:'
        for ($i = 0; $i -lt $found.Count; $i++) { Write-Host ("  {0}. {1} ({2})" -f ($i + 1), $found[$i].Name, $found[$i].Ip) }
        $pick = Read-Host 'Which one? Type its number and press Enter'
        $n = 0
        if ([int]::TryParse($pick, [ref]$n) -and $n -ge 1 -and $n -le $found.Count) { $script:TV = $found[$n - 1].Ip }
    }
    if (-not $script:TV) {
        Line 'No TV with Glass Home answered. Is Glass Home open on the TV, and is this PC on the same Wi-Fi?'
        Write-Host "You can also type the TV's address. On the Fire TV: Settings > My Fire TV > About > Network > IP Address"
        $script:TV = Read-Host 'TV address (e.g. 192.168.1.40)'
        if (-not $script:TV) { Finish 1 }
    }
}
$script:TV = $script:TV.Trim() -replace ':5555$', ''

# ------------------------------------------------------------------ 3. connect
Line "Connecting to $($script:TV)..."
$tries = 0; $told = $false
while ($true) {
    $out = (Adb connect "$($script:TV):5555") -join ' '
    $state = (Adb -s "$($script:TV):5555" get-state) -join ' '
    if ($state -eq 'device') { Write-Host 'Connected.'; break }
    $all = "$out $state"
    if ($all -match 'unauthorized|authenticate') {
        if (-not $told) {
            Line 'On the TV: a box asks to allow this computer.'
            Write-Host '  Choose  Always allow from this computer,  then  OK.'
            Write-Host '  Waiting for you (up to 2 minutes)...'
            $told = $true
        }
        Start-Sleep -Seconds 3; $tries++
        if ($tries -gt 40) { Line "The TV didn't allow this computer. Run this again and press OK on the TV's box."; Finish 1 }
    } elseif ($all -match 'refused|failed to connect|cannot connect|timed out|No route|actively refused') {
        Line "The TV didn't answer. On the Fire TV:"
        Write-Host '  Settings > My Fire TV > Developer options > ADB debugging > On'
        Write-Host "  (No Developer options? Settings > My Fire TV > About > press OK on the TV's name 7 times, then go back.)"
        Write-Host '  Also check the address: Settings > My Fire TV > About > Network.'
        $again = Read-Host 'Press Enter to try again (or type q to stop)'
        if ($again -eq 'q') { Finish 1 }
        Adb disconnect "$($script:TV):5555" | Out-Null
    } else {
        Start-Sleep -Seconds 2; $tries++
        if ($tries -gt 40) { Line "Couldn't connect: $all"; Finish 1 }
    }
}

# ------------------------------------------------------------------ 4. the Home button
if ((TvShell "pm path $PKG") -notmatch 'package:') {
    Line "Glass Home isn't installed on this TV. Install it first (see the download page), then run this again."
    Finish 1
}

Line 'Giving Glass Home the Home button...'
$cur = (TvShell 'settings get secure enabled_accessibility_services').Trim()
if ($cur -match 'HomeWatcher') { $new = $cur }                        # already on
elseif ($cur -eq '' -or $cur -eq 'null') { $new = $ME }
else { $new = "${cur}:$ME" }                                          # keep anything else that's on (e.g. VoiceView)
if ($new -ne $cur) { TvShell "settings put secure enabled_accessibility_services '$new'" | Out-Null }
TvShell 'settings put secure accessibility_enabled 1' | Out-Null
TvShell "pm grant $PKG android.permission.WRITE_SECURE_SETTINGS" | Out-Null     # lets it switch itself back on after Fire TV stops it
TvShell "cmd notification allow_listener $PKG/$PKG.MediaListener" | Out-Null     # Now Playing on the home screen
TvShell "appops set $PKG GET_USAGE_STATS allow" | Out-Null                       # recently used apps first in the app row
Start-Sleep -Seconds 3

$ok = ((TvShell 'settings get secure enabled_accessibility_services') -match 'HomeWatcher') -and
      ((TvShell "dumpsys package $PKG") -match 'WRITE_SECURE_SETTINGS: granted=true')
Adb disconnect "$($script:TV):5555" | Out-Null
Adb kill-server | Out-Null

if ($ok) {
    Line 'Done. The Home button now opens Glass Home - press Home on the remote to try it.'
    Write-Host '  It also turns on Menu Menu (screen off, sound on) and Menu Menu Menu (video in a widget).'
    Write-Host ''
    Write-Host '  You can turn ADB debugging off again now (Settings > My Fire TV > Developer options);'
    Write-Host '  Glass Home keeps the Home button.'
    Finish 0
} else {
    Line "Something didn't take. Run this again; if it still fails, send the text above with your feedback."
    Finish 1
}
