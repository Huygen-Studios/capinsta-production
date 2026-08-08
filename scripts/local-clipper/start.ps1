[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile = Join-Path $root '.env.local.clipper'
$template = Join-Path $root '.env.local.clipper.example'
$data = Join-Path $root '.local-data'
$logs = Join-Path $data 'logs'
$pids = Join-Path $data 'pids'

if (-not (Test-Path $envFile)) { Copy-Item $template $envFile }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item "Env:$($matches[1])" $matches[2] }
}
$env:CAPINSTA_LOCAL_CLIPPER = 'true'
$wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
if ((Test-Path (Join-Path $wingetLinks 'ffmpeg.exe')) -and ($env:Path -notlike "*$wingetLinks*")) {
  $env:Path = "$wingetLinks;$env:Path"
}
foreach ($command in 'docker','bun','ffmpeg','ffprobe') { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required. Install it, then rerun this command." } }
if ((Get-PSDrive C).Free -lt 1GB) { Write-Warning 'C: has less than 1 GB free; local data is stored on F: where possible.' }
$env:CLIPPING_LOCAL_STORAGE_ROOT = $data
$env:MEDIA_PROBE_LOCAL_STORAGE_ROOT = $data
$env:MEDIA_VARIANT_LOCAL_STORAGE_ROOT = $data
$env:TRANSCRIPT_ANALYSIS_LOCAL_STORAGE_ROOT = $data
$env:CLIPPING_EXPORT_LOCAL_STORAGE_ROOT = $data
$env:CLIPPING_EXPORT_TEMP_ROOT = Join-Path $data 'temp'
$env:MEDIA_VARIANT_TEMP_ROOT = Join-Path $data 'temp'
$env:TRANSCRIPTION_TEMP_ROOT = Join-Path $data 'temp'
$env:AUTOMATIC_CLIPPER_TEMP_ROOT = Join-Path $data 'temp'
$env:CLIPPING_RUNTIME_BINARY = Join-Path $root 'target\release\capinsta-clipping-runtime.exe'
foreach ($directory in 'source-media','media-variants','media-exports','temp','logs','pids') { New-Item -ItemType Directory -Force (Join-Path $data $directory) | Out-Null }

docker desktop start | Out-Null
$deadline = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $deadline) { if ((docker version --format '{{.Server.Version}}' 2>$null)) { break }; Start-Sleep 2 }
if (-not (docker version --format '{{.Server.Version}}' 2>$null)) { throw 'Docker Desktop did not become ready.' }
if (-not (docker ps -a --format '{{.Names}}' | Select-String -Quiet '^capinsta-local-clipper-postgres$')) {
  docker run -d --name capinsta-local-clipper-postgres --restart unless-stopped -e POSTGRES_DB=capinsta_local_clipper -e POSTGRES_USER=capinsta -e POSTGRES_PASSWORD=capinsta-local-only -p 127.0.0.1:55432:5432 -v capinsta_local_clipper_pgdata:/var/lib/postgresql/data postgres:17-alpine | Out-Null
} else { docker start capinsta-local-clipper-postgres | Out-Null }
$deadline = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $deadline) { if ((docker exec capinsta-local-clipper-postgres pg_isready -U capinsta -d capinsta_local_clipper 2>$null)) { break }; Start-Sleep 2 }
if (-not (docker exec capinsta-local-clipper-postgres pg_isready -U capinsta -d capinsta_local_clipper 2>$null)) { throw 'Local PostgreSQL did not become ready.' }

Push-Location $root
try {
  & .\backend\venv\Scripts\python.exe .\scripts\local-clipper\migrate.py
  function Start-LocalProcess([string]$name, [string]$file, [string[]]$arguments, [string]$workingDirectory) {
    $pidFile = Join-Path $pids "$name.pid"
    if (Test-Path $pidFile) { $existing = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue; if ($existing) { return } }
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workingDirectory -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log") -PassThru -WindowStyle Hidden
    Set-Content $pidFile $process.Id
  }
  Start-LocalProcess 'api' (Join-Path $root 'backend\venv\Scripts\python.exe') @((Join-Path $root 'scripts\local-clipper\run_api.py')) (Join-Path $root 'backend')
  $deadline = (Get-Date).AddMinutes(1); while ((Get-Date) -lt $deadline) { try { if ((Invoke-WebRequest 'http://127.0.0.1:8000/api/health' -UseBasicParsing).StatusCode -eq 200) { break } } catch {}; Start-Sleep 1 }
  Start-LocalProcess 'worker' (Join-Path $root 'backend\venv\Scripts\python.exe') @('-m','server.clipping_jobs.worker') (Join-Path $root 'backend')
  Start-LocalProcess 'web' (Get-Command bun).Source @('run','--cwd','apps/web','dev','--','--webpack','--hostname','127.0.0.1','--port','3000') $root
  $deadline = (Get-Date).AddMinutes(2); while ((Get-Date) -lt $deadline) { try { if ((Invoke-WebRequest 'http://127.0.0.1:3000/clipper' -UseBasicParsing).StatusCode -eq 200) { break } } catch {}; Start-Sleep 1 }
  if (-not (Test-Path (Join-Path $pids 'web.pid'))) { throw 'Next.js did not start.' }
  Write-Host "`nAUTOMATIC CLIPPER IS RUNNING`n`nOpen:`nhttp://localhost:3000/clipper`n`nLogs:`n$logs" -ForegroundColor Green
} finally { Pop-Location }
