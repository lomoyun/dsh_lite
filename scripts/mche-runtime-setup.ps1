param(
    [string]$PythonSource,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $projectRoot 'runtime'
$pythonTarget = Join-Path $projectRoot '.dsh\mche-python-x86'
$pythonExe = Join-Path $pythonTarget 'python.exe'
# Hash all runtime files in the actual Worker below. On this host PowerShell and
# Python can receive different file streams for managed spreadsheet resources.
if (-not $CheckOnly) {
    if (-not $PythonSource) { throw 'Provide -PythonSource with an existing complete standalone Windows x86 CPython directory.' }
    if (Test-Path -LiteralPath $pythonTarget) { throw 'Project interpreter already exists. Use -CheckOnly; no existing directory or junction will be changed.' }
    $sourceRoot = (Resolve-Path -LiteralPath $PythonSource).Path
    $sourceExe = Join-Path $sourceRoot 'python.exe'
    $peBytes = [IO.File]::ReadAllBytes($sourceExe)
    $peOffset = [BitConverter]::ToInt32($peBytes, 60)
    if ([BitConverter]::ToUInt16($peBytes, $peOffset + 4) -ne 0x14c) { throw 'Python executable is not x86.' }
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'Lib\encodings'))) { throw 'A complete standalone Python distribution with Lib/encodings is required.' }
    New-Item -ItemType Directory -Path $pythonTarget | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File) {
        if ($file.Name -eq 'python.exe' -or $file.Extension -eq '.dll' -or $file.Name -eq 'LICENSE.txt') {
            Copy-Item -LiteralPath $file.FullName -Destination $pythonTarget
        }
    }
    function Copy-PythonTree([string]$sourceDir, [string]$targetDir) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        foreach ($entry in Get-ChildItem -LiteralPath $sourceDir -Force) {
            if ($entry.Name -in @('site-packages', '__pycache__')) { continue }
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unexpected junction in Python library: $($entry.FullName)" }
            if ($entry.PSIsContainer) { Copy-PythonTree $entry.FullName (Join-Path $targetDir $entry.Name) }
            else { Copy-Item -LiteralPath $entry.FullName -Destination $targetDir }
        }
    }
    foreach ($directory in @('Lib', 'DLLs')) {
        $candidate = Join-Path $sourceRoot $directory
        if (Test-Path -LiteralPath $candidate) { Copy-PythonTree $candidate (Join-Path $pythonTarget $directory) }
    }
    # Create only the new project-owned junction. Never repair or replace the source interpreter's SHDLL.
    New-Item -ItemType Junction -Path (Join-Path $pythonTarget 'SHDLL') -Target (Join-Path $runtimeRoot 'SHDLL') | Out-Null
}
$worker = Join-Path $projectRoot 'packages\dsh-mche\src\worker\worker.py'
$command = @{ protocolVersion=1; type='probe'; runId='runtime-setup'; runtimeRoot=$runtimeRoot } | ConvertTo-Json -Compress
$command | & $pythonExe -E -B -X utf8 -u $worker
if ($LASTEXITCODE -ne 0) { throw 'Native runtime probe failed. Keep the evidence and inspect the reported error.' }
Write-Output 'MCHE x86 environment verified. This does not verify engineering accuracy.'
