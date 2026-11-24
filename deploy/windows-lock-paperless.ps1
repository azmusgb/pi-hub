# One home, step 6 (lock): Paperless (port 8010 on the PC) answers only the Pi, where the front gate
# (https://paperless.rahe-home.duckdns.org) and the hub's Documents page reach it. Windows PowerShell 5.1, run as an admin:
#   powershell -NoProfile -File windows-lock-paperless.ps1 -Status | -Apply | -Undo
# Another PC tool behind the same gate takes -Port and -Label, e.g. -Port 8030 -Label MyTool.
# Docker Desktop's own firewall rules allow its program on every port, so this adds one Block rule for TCP 8010 from
# every address except 10.0.0.80 (a block wins over an allow) and leaves Docker's rules alone. Loopback isn't filtered.
param([switch]$Status, [switch]$Apply, [switch]$Undo, [int]$Port = 8010, [string]$Label = 'Paperless')
$ErrorActionPreference = 'Stop'
$Name = "PiLock-$Label-$Port"
$NotThePi = @('0.0.0.0-10.0.0.79', '10.0.0.81-255.255.255.255', '::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')

function Show {
  $r = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if ($r) {
    $a = $r | Get-NetFirewallAddressFilter
    'locked: {0} ({1}, {2}) blocks TCP {4} from {3}' -f $r.Name, $r.Enabled, $r.Action, ($a.RemoteAddress -join ', '), $Port
  } else { 'open: no lock rule; TCP {0} follows Docker Desktop''s rules' -f $Port }
  $l = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) { 'listening: {0}:{2} by {1}' -f $l.LocalAddress, (Get-Process -Id $l.OwningProcess).ProcessName, $Port }
  else { 'listening: nothing on {0}' -f $Port }
}

if ($Apply) {
  if (Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue) {
    # An existing rule keeps the address it was made with; set it, so a moved Pi follows.
    Set-NetFirewallRule -Name $Name -RemoteAddress $NotThePi
  } else {
    New-NetFirewallRule -Name $Name -DisplayName "Pi lock: $Label $Port only from the Pi (one home step 6)" `
      -Direction Inbound -Action Block -Protocol TCP -LocalPort $Port -RemoteAddress $NotThePi -Profile Any | Out-Null
  }
} elseif ($Undo) {
  Remove-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
} elseif (-not $Status) {
  'usage: windows-lock-paperless.ps1 -Status | -Apply | -Undo'; exit 2
}
Show
