$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pids = Join-Path $root '.local-data\pids'
foreach ($name in 'api','worker','web') { $id = if (Test-Path (Join-Path $pids "$name.pid")) { Get-Content (Join-Path $pids "$name.pid") } else { '-' }; $state = Get-Process -Id $id -ErrorAction SilentlyContinue; "$name : $(if($state){'running'}else{'stopped'}) ($id)" }
docker ps --filter name=capinsta-local-clipper-postgres --format 'postgres : {{.Status}}'
