# One home, step 6 (lock): Paperless (port 8010 on the PC) answers only the Pi, where the front gate
# (https://paperless.rahe-home.duckdns.org) and the hub's Documents page reach it. Windows PowerShell 5.1, run as an admin:
#   powershell -NoProfile -File windows-lock-paperless.ps1 -Status | -Apply | -Undo
# Docker Desktop's own firewall rules allow its program on every port, so this adds one Block rule for TCP 8010 from
# every address except 10.0.0.80 (a block wins over an allow) and leaves Docker's rules alone. Loopback isn't filtered.
param([switch]$Status, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'
$Name = 'PiLock-Paperless-8010'
$NotThePi = @('0.0.0.0-10.0.0.29', '10.0.0.31-255.255.255.255', '::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')

function Show {
  $r = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if ($r) {
    $a = $r | Get-NetFirewallAddressFilter
    'locked: {0} ({1}, {2}) blocks TCP 8010 from {3}' -f $r.Name, $r.Enabled, $r.Action, ($a.RemoteAddress -join ', ')
  } else { 'open: no lock rule; TCP 8010 follows Docker Desktop''s rules' }
  $l = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) { 'listening: {0}:8010 by {1}' -f $l.LocalAddress, (Get-Process -Id $l.OwningProcess).ProcessName }
  else { 'listening: nothing on 8010' }
}

if ($Apply) {
  if (-not (Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $Name -DisplayName 'Pi lock: Paperless 8010 only from the Pi (one home step 6)' `
      -Direction Inbound -Action Block -Protocol TCP -LocalPort 8010 -RemoteAddress $NotThePi -Profile Any | Out-Null
  }
} elseif ($Undo) {
  Remove-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
} elseif (-not $Status) {
  'usage: windows-lock-paperless.ps1 -Status | -Apply | -Undo'; exit 2
}
Show
