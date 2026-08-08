$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pids = Join-Path $root '.local-data\pids'
foreach ($name in 'web','worker','api') {
  $pidFile = Join-Path $pids "$name.pid"
  if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -Force -ErrorAction SilentlyContinue; Remove-Item $pidFile -Force }
}
Write-Host 'Local Clipper processes stopped. PostgreSQL data is preserved.'
