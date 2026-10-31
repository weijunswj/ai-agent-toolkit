<#
Notepad tab-restore probe for toolkit env edit (Windows 11 Notepad).

Checks whether Notepad keeps its own copy of an edit-style file in its tab-restore data
(LocalState\TabState) after the file is closed and deleted. Uses a made-up canary value only and
reports file names and yes/no answers, never file content.

Set Notepad > Settings > When Notepad starts to the setting under test first, then run one case:

  powershell -NoProfile -ExecutionPolicy Bypass -File repo\tests\manual\notepad-tabstate-probe.ps1 -Case Saved -Setting "Start new session"
  ... -Case Saved -Setting "Continue previous session"
  ... -Case Unsaved -Setting "Continue previous session"
  ... -Case Killed -Setting "Continue previous session"

Cases:
  Saved    the file is opened, then Notepad is closed normally.
  Unsaved  a second canary is typed into the tab without saving, then Notepad is closed normally
           (answer "Don't save" if Notepad asks).
  Killed   Notepad is stopped while the file is open.

It stops, and changes nothing, if Notepad is already running (your own tabs are never closed).
Run it in a PowerShell window started outside any packaged app: from inside one (such as the Claude
desktop app's shell), Windows can hide Notepad's TabState folder, and every answer then reads "no".
Scratch goes under $env:USERPROFILE\t and is deleted at the end.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Saved', 'Unsaved', 'Killed')][string]$Case,
  [Parameter(Mandatory = $true)][string]$Setting
)

$ErrorActionPreference = 'Stop'

if (Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue) {
  Write-Output 'Notepad is already open. Close your own Notepad windows first; this probe never closes them.'
  exit 2
}

$tabState = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe\LocalState\TabState'
$scratch = Join-Path $env:USERPROFILE ("t\notepad-probe-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$file = Join-Path $scratch ('env-edit-' + (-join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })) + '.env')
$canary = 'X1_PROBE_' + [guid]::NewGuid().ToString('N')
$typed = 'X1_TYPED_' + [guid]::NewGuid().ToString('N')
Set-Content -LiteralPath $file -Value "X1_PROBE_DUMMY_KEY=$canary" -Encoding UTF8

function Find-InTabState([string]$text) {
  if (-not (Test-Path -LiteralPath $tabState)) { return @() }
  $needle = [System.Text.Encoding]::Unicode.GetBytes($text)
  $found = @()
  foreach ($bin in Get-ChildItem -LiteralPath $tabState -Filter '*.bin' -File -ErrorAction SilentlyContinue) {
    $bytes = [System.IO.File]::ReadAllBytes($bin.FullName)
    for ($i = 0; $i -le $bytes.Length - $needle.Length; $i++) {
      $match = $true
      for ($j = 0; $j -lt $needle.Length; $j++) { if ($bytes[$i + $j] -ne $needle[$j]) { $match = $false; break } }
      if ($match) { $found += $bin.Name; break }
    }
  }
  return $found
}

try {
  $before = @(Get-ChildItem -LiteralPath $tabState -Filter '*.bin' -File -ErrorAction SilentlyContinue | ForEach-Object Name)
  Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\notepad.exe') -ArgumentList "`"$file`""
  Start-Sleep -Seconds 4
  $notepad = Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $notepad) { throw 'Notepad did not open a window.' }
  if ($Case -eq 'Unsaved') {
    $shell = New-Object -ComObject WScript.Shell
    if ($shell.AppActivate($notepad.Id)) { Start-Sleep -Milliseconds 500; $shell.SendKeys("^{END}{ENTER}$typed") }
    Start-Sleep -Seconds 3
  }
  if ($Case -eq 'Killed') { Stop-Process -Id $notepad.Id -Force }
  else {
    [void]$notepad.CloseMainWindow()
    Start-Sleep -Seconds 3
    if (-not $notepad.HasExited) { Write-Output 'Notepad is still open (it may be asking to save). Choose "Don''t save" and close it, then press Enter.'; [void](Read-Host) }
  }
  Start-Sleep -Seconds 2
  # As toolkit env does at "done": overwrite with zeros, then delete.
  $size = (Get-Item -LiteralPath $file).Length
  [System.IO.File]::WriteAllBytes($file, (New-Object byte[] $size))
  Remove-Item -LiteralPath $file -Force

  $after = @(Get-ChildItem -LiteralPath $tabState -Filter '*.bin' -File -ErrorAction SilentlyContinue | ForEach-Object Name)
  $pathHits = @(Find-InTabState $file)
  $canaryHits = @(Find-InTabState $canary)
  $typedHits = @(Find-InTabState $typed)
  Write-Output "Case: $Case; setting: $Setting"
  Write-Output ("TabState folder present: " + $(if (Test-Path -LiteralPath $tabState) { 'yes' } else { 'no' }))
  Write-Output ("New tab-restore files: " + $(if ($after | Where-Object { $before -notcontains $_ }) { (($after | Where-Object { $before -notcontains $_ }) -join ', ') } else { 'none' }))
  Write-Output ("Edit file path kept (the Toolkit warning fires): " + $(if ($pathHits.Count) { 'yes (' + ($pathHits -join ', ') + ')' } else { 'no' }))
  Write-Output ("Saved canary kept: " + $(if ($canaryHits.Count) { 'yes (' + ($canaryHits -join ', ') + ')' } else { 'no' }))
  if ($Case -eq 'Unsaved') { Write-Output ("Unsaved typed canary kept: " + $(if ($typedHits.Count) { 'yes (' + ($typedHits -join ', ') + ')' } else { 'no' })) }
  if (($canaryHits.Count -or $typedHits.Count) -and -not $pathHits.Count) { Write-Output 'WARNING: a canary is kept but the file path is not, so the Toolkit warning would not fire.' }
}
finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
