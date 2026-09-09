[CmdletBinding()]
param(
  [switch]$RequireLiveRelease
)

$ErrorActionPreference = 'Continue'
$missing = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Require-Command($Name, $Label) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    $missing.Add("$Label ($Name)")
  }
}

function Require-Environment($Name, $Label) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    $missing.Add("$Label ($Name)")
  }
}

Require-Command 'node' 'Node.js'
Require-Command 'npm' 'npm'
Require-Command 'cargo' 'Rust/Cargo for Tauri'
Require-Command 'adb' 'Android Debug Bridge'
Require-Command 'gradle' 'Gradle'
Require-Command 'java' 'JDK'

if (-not (Test-Path 'desktop/src-tauri/tauri.conf.json')) {
  $missing.Add('Tauri project configuration')
}
if (-not (Test-Path 'mobile')) {
  $missing.Add('Capacitor mobile project')
}

Require-Environment 'TAURI_SIGNING_PRIVATE_KEY' 'Tauri updater private key'
Require-Environment 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' 'Tauri updater key password'
Require-Environment 'ANDROID_KEYSTORE_PATH' 'Android release keystore path'
Require-Environment 'ANDROID_KEYSTORE_PASSWORD' 'Android keystore password'
Require-Environment 'ANDROID_KEY_ALIAS' 'Android key alias'
Require-Environment 'ANDROID_KEY_PASSWORD' 'Android key password'

if ([string]::IsNullOrWhiteSpace($env:TAURI_UPDATER_ENDPOINT) -or [string]::IsNullOrWhiteSpace($env:TAURI_UPDATER_PUBLIC_KEY)) {
  $warnings.Add('Tauri auto-update remains disabled until both TAURI_UPDATER_ENDPOINT and TAURI_UPDATER_PUBLIC_KEY are provided.')
}

if ($RequireLiveRelease) {
  Require-Environment 'E2E_API_URL' 'deployed staging API URL'
  Require-Environment 'E2E_USER_A_TOKEN' 'staging user A token'
  Require-Environment 'E2E_USER_B_TOKEN' 'staging user B token'
  Require-Environment 'GITHUB_TOKEN' 'GitHub release/deployment credential'
}

if ($missing.Count -gt 0) {
  Write-Host 'RELEASE PREFLIGHT: BLOCKED' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Missing prerequisites:' -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host 'RELEASE PREFLIGHT: local prerequisites present' -ForegroundColor Green
}

if ($warnings.Count -gt 0) {
  Write-Host ''
  Write-Host 'Warnings:' -ForegroundColor Yellow
  $warnings | ForEach-Object { Write-Host " - $_" }
}

if ($missing.Count -gt 0) {
  exit 1
}
