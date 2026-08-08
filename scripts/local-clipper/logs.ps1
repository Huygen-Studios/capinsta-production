$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Get-ChildItem (Join-Path $root '.local-data\logs') -File | ForEach-Object { "`n--- $($_.Name)"; Get-Content $_.FullName -Tail 80 }
