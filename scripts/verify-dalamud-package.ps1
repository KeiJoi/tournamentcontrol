[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedInternalName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PackagePath))
try {
    $names = @($archive.Entries | ForEach-Object FullName)
    foreach ($required in @('TournamentControl.Dalamud.dll', 'TournamentControl.Dalamud.deps.json', 'TournamentControl.Dalamud.json')) {
        if ($names -notcontains $required) { throw "Package is missing required entry: $required" }
    }

    $manifestEntry = $archive.Entries | Where-Object FullName -eq 'TournamentControl.Dalamud.json' | Select-Object -First 1
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.InternalName -ne $ExpectedInternalName) { throw "Package manifest InternalName does not match $ExpectedInternalName." }
    if ($manifest.AssemblyVersion -ne "$ExpectedVersion.0") { throw "Package manifest AssemblyVersion does not match $ExpectedVersion.0." }
    if ([int]$manifest.DalamudApiLevel -ne 15) { throw 'Package manifest is not targeting Dalamud API level 15.' }
} finally {
    $archive.Dispose()
}

Write-Output "Validated Dalamud package: $PackagePath"
