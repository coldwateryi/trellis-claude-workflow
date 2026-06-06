[CmdletBinding()]
param(
    [string]$SourceDir,
    [switch]$Online,
    [string]$ProjectDir,
    [string]$TargetDir,
    [Alias("Global")]
    [switch]$InstallGlobal,
    [switch]$Yes,
    [string]$RepoUrl = "https://github.com/coldwateryi/trellis-claude-workflow",
    [Alias("Ref")]
    [string]$Branch = "main"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$WorkflowFiles = @(
    "trellis-parallel-implement.js",
    "trellis-parallel-research.js",
    "trellis-dag-implement.js"
)

function Resolve-ExistingDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($null -eq $item -or -not $item.PSIsContainer) {
        return $null
    }

    return $item.FullName
}

function Test-TrellisProject {
    param([Parameter(Mandatory = $true)][string]$Path)

    return Test-Path -LiteralPath (Join-Path $Path ".trellis") -PathType Container
}

function Test-WorkflowSource {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath (Join-Path $Path "scripts") -PathType Container)) {
        return $false
    }

    foreach ($workflowFile in $WorkflowFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $workflowFile) -PathType Leaf)) {
            return $false
        }
    }

    return $true
}

function Get-LocalWorkflowSource {
    if (-not [string]::IsNullOrWhiteSpace($env:TRELLIS_WORKFLOW_SOURCE_DIR)) {
        $envSourceDir = Resolve-ExistingDirectory -Path $env:TRELLIS_WORKFLOW_SOURCE_DIR
        if ($null -ne $envSourceDir -and (Test-WorkflowSource -Path $envSourceDir)) {
            return $envSourceDir
        }
        throw "TRELLIS_WORKFLOW_SOURCE_DIR is not a workflow source directory: $env:TRELLIS_WORKFLOW_SOURCE_DIR"
    }

    $currentDir = (Get-Location).Path
    if (Test-WorkflowSource -Path $currentDir) {
        return $currentDir
    }

    if ((Split-Path -Leaf $currentDir) -eq "scripts") {
        $parentDir = Resolve-ExistingDirectory -Path (Join-Path $currentDir "..")
        if ($null -ne $parentDir -and (Test-WorkflowSource -Path $parentDir)) {
            return $parentDir
        }
    }

    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptPath = $MyInvocation.MyCommand.Path
    }

    if (-not [string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptDir = Resolve-ExistingDirectory -Path (Split-Path -Parent $scriptPath)
        if ($null -ne $scriptDir -and (Split-Path -Leaf $scriptDir) -eq "scripts") {
            $parentDir = Resolve-ExistingDirectory -Path (Join-Path $scriptDir "..")
            if ($null -ne $parentDir -and (Test-WorkflowSource -Path $parentDir)) {
                return $parentDir
            }
        }
    }

    return $null
}

function Get-ClaudeGlobalWorkflowsRoot {
    if ([string]::IsNullOrWhiteSpace($HOME)) {
        throw "Unable to determine global Claude workflow directory. Set HOME."
    }

    return Join-Path (Join-Path $HOME ".claude") "workflows"
}

function Read-GlobalInstallChoice {
    param([Parameter(Mandatory = $true)][string]$CheckedDir)

    if ($InstallGlobal -or $Yes) {
        return $true
    }

    while ($true) {
        $answer = Read-Host "Directory $CheckedDir is not a Trellis project. Install globally instead? [y/N]"

        switch -Regex ($answer) {
            '^(Y|y|Yes|yes|YES|是)$' { return $true }
            '^\s*$' { return $false }
            '^(N|n|No|no|NO|否)$' { return $false }
            default { Write-Host "Please enter y/yes/是 or n/no/否." }
        }
    }
}

function Read-TrellisProjectDirectory {
    while ($true) {
        $inputDir = Read-Host "Enter a Trellis-initialized project directory"

        if ([string]::IsNullOrWhiteSpace($inputDir)) {
            Write-Host "Project directory cannot be empty."
            continue
        }

        $resolvedDir = Resolve-ExistingDirectory -Path $inputDir
        if ($null -eq $resolvedDir) {
            Write-Host "Directory does not exist: $inputDir"
            continue
        }

        if (Test-TrellisProject -Path $resolvedDir) {
            return [PSCustomObject]@{
                Scope = "project"
                TargetDir = $resolvedDir
            }
        }

        Write-Host "No .trellis/ directory found: $resolvedDir"
        if (Read-GlobalInstallChoice -CheckedDir $resolvedDir) {
            return [PSCustomObject]@{
                Scope = "global"
                TargetDir = $null
            }
        }

        Write-Host "Run trellis init first, or enter another initialized Trellis project directory."
    }
}

function Resolve-InstallTarget {
    if (-not [string]::IsNullOrWhiteSpace($TargetDir)) {
        return [PSCustomObject]@{
            Scope = "direct"
            TargetDir = $TargetDir
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:TRELLIS_WORKFLOW_INSTALL_DIR)) {
        return [PSCustomObject]@{
            Scope = "direct"
            TargetDir = $env:TRELLIS_WORKFLOW_INSTALL_DIR
        }
    }

    if ($InstallGlobal) {
        return [PSCustomObject]@{
            Scope = "global"
            TargetDir = $null
        }
    }

    $resolvedProjectDir = $ProjectDir
    if ([string]::IsNullOrWhiteSpace($resolvedProjectDir) -and -not [string]::IsNullOrWhiteSpace($env:TRELLIS_WORKFLOW_PROJECT_DIR)) {
        $resolvedProjectDir = $env:TRELLIS_WORKFLOW_PROJECT_DIR
    }

    if (-not [string]::IsNullOrWhiteSpace($resolvedProjectDir)) {
        $candidateDir = Resolve-ExistingDirectory -Path $resolvedProjectDir
        if ($null -eq $candidateDir) {
            throw "Project directory does not exist: $resolvedProjectDir"
        }

        if (Test-TrellisProject -Path $candidateDir) {
            return [PSCustomObject]@{
                Scope = "project"
                TargetDir = $candidateDir
            }
        }

        Write-Host "Specified project directory is not a Trellis project: $candidateDir"
        if (Read-GlobalInstallChoice -CheckedDir $candidateDir) {
            return [PSCustomObject]@{
                Scope = "global"
                TargetDir = $null
            }
        }

        return Read-TrellisProjectDirectory
    }

    $currentDir = (Get-Location).Path
    if (Test-TrellisProject -Path $currentDir) {
        return [PSCustomObject]@{
            Scope = "project"
            TargetDir = $currentDir
        }
    }

    Write-Host "Current directory is not a Trellis project: $currentDir"
    return Read-TrellisProjectDirectory
}

function Copy-WorkflowsToInstallRoot {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Write-Host "Preparing workflow install. source_dir=$SourceDir install_root=$InstallRoot"

    foreach ($workflowFile in $WorkflowFiles) {
        $sourceFile = Join-Path $SourceDir $workflowFile
        $targetFile = Join-Path $InstallRoot $workflowFile

        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            throw "Workflow source file is missing: $sourceFile"
        }

        Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
        Write-Host "Installed $workflowFile -> $targetFile"
    }
}

function Find-WorkflowSourceInDirectory {
    param([Parameter(Mandatory = $true)][string]$SearchRoot)

    return Get-ChildItem -Path $SearchRoot -Directory |
        Where-Object { Test-WorkflowSource -Path $_.FullName } |
        Select-Object -First 1
}

$installTarget = Resolve-InstallTarget
switch ($installTarget.Scope) {
    "project" { $installRoot = Join-Path (Join-Path $installTarget.TargetDir ".claude") "workflows" }
    "global" { $installRoot = Get-ClaudeGlobalWorkflowsRoot }
    "direct" { $installRoot = $installTarget.TargetDir }
    default { throw "Unknown install scope: $($installTarget.Scope)" }
}

$sourceRoot = $null
$tempRoot = $null

try {
    if (-not [string]::IsNullOrWhiteSpace($SourceDir)) {
        $resolvedSourceDir = Resolve-ExistingDirectory -Path $SourceDir
        if ($null -eq $resolvedSourceDir -or -not (Test-WorkflowSource -Path $resolvedSourceDir)) {
            throw "Source directory is not a workflow template source: $SourceDir"
        }
        $sourceRoot = $resolvedSourceDir
        Write-Host "Using explicit local workflow source directory: $sourceRoot"
    }
    elseif (-not $Online) {
        $sourceRoot = Get-LocalWorkflowSource
        if ($null -ne $sourceRoot) {
            Write-Host "Using detected local workflow source directory: $sourceRoot"
        }
    }

    if ($null -eq $sourceRoot) {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("trellis-workflows-" + [System.Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

        $archiveUrl = "$RepoUrl/archive/$Branch.zip"
        $archivePath = Join-Path $tempRoot "trellis-workflows.zip"

        Write-Host "No local workflow source detected. Downloading workflow templates from $archiveUrl"
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing

        Expand-Archive -Path $archivePath -DestinationPath $tempRoot -Force
        $sourceDir = Find-WorkflowSourceInDirectory -SearchRoot $tempRoot

        if ($null -eq $sourceDir) {
            throw "Could not locate extracted trellis-claude-workflow source directory."
        }

        $sourceRoot = $sourceDir.FullName
    }

    Copy-WorkflowsToInstallRoot -SourceDir $sourceRoot -InstallRoot $installRoot
    Write-Host "Trellis workflow templates installed to: $installRoot"
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($tempRoot) -and (Test-Path -LiteralPath $tempRoot)) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
