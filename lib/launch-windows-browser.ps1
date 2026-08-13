param(
    [ValidateSet('Ensure', 'Status', 'Stop')]
    [string]$Mode = 'Ensure',

    [ValidateSet('chrome', 'edge')]
    [string]$Browser = 'chrome',

    [ValidateRange(1024, 65535)]
    [int]$Port = 9223,

    [string]$ProfileDir = '',
    [string]$Url = 'about:blank'
)

$ErrorActionPreference = 'Stop'
$MarkerName = '.agent-skills-browser-profile.json'
$MarkerPurpose = 'agent-skills-dedicated-browser'

if (-not $ProfileDir) {
    $ProfileDir = Join-Path $env:LOCALAPPDATA 'AgentSkillsBrowserProfiles\Atlassian'
}
$ProfileDir = [System.IO.Path]::GetFullPath($ProfileDir)
$MarkerPath = Join-Path $ProfileDir $MarkerName

$browserCandidates = if ($Browser -eq 'edge') {
    @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
} else {
    @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )
}

$browserPath = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $browserPath) {
    throw "Could not find Windows $Browser. Checked: $($browserCandidates -join ', ')"
}

if (Test-Path -LiteralPath $ProfileDir) {
    if (Test-Path -LiteralPath $MarkerPath) {
        $marker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
        if ($marker.purpose -ne $MarkerPurpose) {
            throw "Browser profile marker at $MarkerPath has an unexpected purpose. Refusing to use this profile."
        }
    } else {
        $entries = @(Get-ChildItem -LiteralPath $ProfileDir -Force -ErrorAction Stop)
        if ($entries.Count -gt 0) {
            throw "Browser profile $ProfileDir is non-empty and is not marked as an Agent Skills dedicated profile. Refusing to use it."
        }
    }
}

$browserNames = @('chrome.exe', 'msedge.exe')
$expectedProcessName = if ($Browser -eq 'edge') { 'msedge.exe' } else { 'chrome.exe' }
$portPattern = "--remote-debugging-port=$Port(?:\s|`"|$)"
$debugProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object {
            $browserNames -contains $_.Name -and
            $_.CommandLine -and
            $_.CommandLine -match $portPattern
        }
)
$matchingProcesses = @(
    $debugProcesses | Where-Object {
        $_.Name -eq $expectedProcessName -and
        $_.CommandLine.IndexOf($ProfileDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    }
)

if ($debugProcesses.Count -gt 0 -and $matchingProcesses.Count -eq 0) {
    throw "DevTools port $Port belongs to a browser that was not launched with the expected dedicated profile. Refusing to attach or stop it."
}

if ($Mode -eq 'Status') {
    [ordered]@{
        status = if ($matchingProcesses.Count) { 'running' } else { 'stopped' }
        port = $Port
        browser = $Browser
        profile = $ProfileDir
        processIds = @($matchingProcesses | ForEach-Object { $_.ProcessId })
    } | ConvertTo-Json -Compress
    exit 0
}

if ($Mode -eq 'Stop') {
    foreach ($process in $matchingProcesses) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    }
    [ordered]@{
        status = if ($matchingProcesses.Count) { 'stopped' } else { 'already-stopped' }
        port = $Port
        browser = $Browser
        profile = $ProfileDir
        processIds = @($matchingProcesses | ForEach-Object { $_.ProcessId })
    } | ConvertTo-Json -Compress
    exit 0
}

if ($matchingProcesses.Count) {
    [ordered]@{
        status = 'reused'
        port = $Port
        browser = $Browser
        executable = $browserPath
        profile = $ProfileDir
        processIds = @($matchingProcesses | ForEach-Object { $_.ProcessId })
    } | ConvertTo-Json -Compress
    exit 0
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
if (-not (Test-Path -LiteralPath $MarkerPath)) {
    [ordered]@{
        purpose = $MarkerPurpose
        createdBy = '@aholbreich/agent-skills'
        createdAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $MarkerPath -Encoding UTF8
}

# Windows PowerShell 5.1 joins ArgumentList values. Embed quotes around values
# that may contain spaces instead of relying on ArgumentList quoting.
$arguments = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=http://127.0.0.1',
    "--user-data-dir=`"$ProfileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    "`"$Url`""
)
$process = Start-Process -FilePath $browserPath -ArgumentList $arguments -PassThru

[ordered]@{
    status = 'launched'
    port = $Port
    browser = $Browser
    executable = $browserPath
    profile = $ProfileDir
    processIds = @($process.Id)
} | ConvertTo-Json -Compress
