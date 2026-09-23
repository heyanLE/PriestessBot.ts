param(
    [string]$NasUser = "heyanhub",
    [string]$NasHost = "192.168.31.24",
    [string]$RemoteBase = "/home/heyanhub/apps/priestessbot"
)

$ErrorActionPreference = "Stop"
$bash = Get-Command bash -ErrorAction Stop
$scriptPath = (Join-Path $PSScriptRoot "deploy-nas.sh").Replace('\', '/')
Write-Host "Deploying the current distribution with the v3 workflow (requires Bash / Git Bash)."
Write-Host "Existing NAS configuration migrates in place; no configuration is generated from a local BAT file."
& $bash.Source $scriptPath "${NasUser}@${NasHost}" $RemoteBase
if ($LASTEXITCODE -ne 0) {
    throw "NAS deployment failed with exit code $LASTEXITCODE"
}
