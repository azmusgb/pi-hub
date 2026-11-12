# Copies the Raspberry Pi's newest nightly backup to this PC and keeps the last 14. Run by the task "Pi Hub backup copy".
$d = "C:\LocalAI\pi-backups"; $k = "$d\pi-backup-key"; $kh = "$d\known_hosts"; $log = "$d\last.txt"
$base = "-i `"$k`" -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=`"$kh`" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 pi-backup@10.0.0.80"
function Say($m) { "$(Get-Date -Format s) $m" | Set-Content $log; $m }
$name = (cmd /c "ssh.exe $base name" 2>$null | Out-String).Trim()
if ($name -notmatch '^pi-[0-9-]+\.tgz$') { Say "STOP: the Pi didn't answer with a backup name"; exit 1 }
$dest = Join-Path $d $name
if (-not (Test-Path $dest)) {
  cmd /c "ssh.exe $base get > `"$dest.part`"" 2>$null
  $want = (cmd /c "ssh.exe $base sha" 2>$null | Out-String).Trim()
  $got = (Get-FileHash "$dest.part" -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want) { Remove-Item "$dest.part" -ErrorAction SilentlyContinue; Say "STOP: checksum mismatch for $name"; exit 1 }
  Move-Item "$dest.part" $dest -Force
} else { cmd /c "ssh.exe $base sha" 2>$null | Out-Null }
Get-ChildItem $d -Filter "pi-*.tgz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item
Say "copied $name ($([math]::Round((Get-Item $dest).Length / 1MB)) MB)"
