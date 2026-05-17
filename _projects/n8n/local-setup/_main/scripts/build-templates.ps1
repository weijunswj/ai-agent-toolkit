$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$TemplatesDir = Join-Path $RepoRoot 'templates'
$PartialsDir = Join-Path $TemplatesDir 'partials'

$AgentExecutionPath = Join-Path $PartialsDir 'ai-coding-agent-execution.md'
$SharedRulesPath = Join-Path $PartialsDir 'n8n-mcp-rules.md'

$FenceEnd = @'
````````
'@

$AgentExecution = (Get-Content -Path $AgentExecutionPath -Raw).TrimEnd()
$SharedRules = (Get-Content -Path $SharedRulesPath -Raw).TrimEnd()

$AgentsWrapper = @'
# AGENTS.md AI coding agent and n8n MCP workflow rules

Use this template for **Codex** or **OpenCode** global `AGENTS.md` rules.

## For Codex

### Copy everything below into:

```text
C:\Users\<your-user>\.codex\AGENTS.md
```

### Or create it with PowerShell:

```text
mkdir $HOME\.codex -Force
notepad $HOME\.codex\AGENTS.md
```

## For OpenCode

### Copy everything below into:

```text
C:\Users\<your-user>\.config\opencode\AGENTS.md
```

### Or create it with PowerShell:

```text
mkdir $HOME\.config\opencode -Force
notepad $HOME\.config\opencode\AGENTS.md
```

---

````````md
'@

$ClaudeWrapper = @'
# CLAUDE.md AI coding agent and n8n MCP workflow rules

Use this template for **Claude Code** global `CLAUDE.md` rules.

### Copy everything below into:

```text
C:\Users\<your-user>\.claude\CLAUDE.md
```

### Or create it with PowerShell:

```text
mkdir $HOME\.claude -Force
notepad $HOME\.claude\CLAUDE.md
```

---

````````md
'@

$GeminiWrapper = @'
# GEMINI.md AI coding agent and n8n MCP workflow rules

Use this template for **Google Antigravity** or **Gemini CLI** global `GEMINI.md` rules.

### Copy everything below into:

```text
C:\Users\<your-user>\.gemini\GEMINI.md
```

### Or create it with PowerShell:

```text
mkdir $HOME\.gemini -Force
notepad $HOME\.gemini\GEMINI.md
```

---

````````md
'@

function New-GeneratedNotice {
    param(
        [Parameter(Mandatory = $true)] [string[]] $SourceFiles
    )

    $SourceLines = ($SourceFiles | ForEach-Object { "- $_" }) -join "`n"

    return @"
<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.

Edit these source files instead:
$SourceLines

Then regenerate the copy-paste templates with:
- scripts/build-templates.ps1
- scripts/- build-templates.cmd
-->


"@
}

function Write-GeneratedTemplate {
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [string[]] $SourceFiles,
        [Parameter(Mandatory = $true)] [string] $Body
    )

    $Notice = New-GeneratedNotice -SourceFiles $SourceFiles
    $Content = $Notice + $Body.TrimEnd() + "`n"
    Set-Content -Path $Path -Value $Content -Encoding utf8 -NoNewline
}

$SharedTemplateSources = @(
    'templates/partials/ai-coding-agent-execution.md',
    'templates/partials/n8n-mcp-rules.md'
)

Write-GeneratedTemplate -Path (Join-Path $TemplatesDir 'AGENTS.md') -SourceFiles $SharedTemplateSources -Body ($AgentsWrapper.TrimEnd() + "`n" + $AgentExecution + "`n`n" + $SharedRules + "`n" + $FenceEnd)
Write-GeneratedTemplate -Path (Join-Path $TemplatesDir 'CLAUDE.md') -SourceFiles $SharedTemplateSources -Body ($ClaudeWrapper.TrimEnd() + "`n" + $AgentExecution + "`n`n" + $SharedRules + "`n" + $FenceEnd)
Write-GeneratedTemplate -Path (Join-Path $TemplatesDir 'GEMINI.md') -SourceFiles $SharedTemplateSources -Body ($GeminiWrapper.TrimEnd() + "`n" + $AgentExecution + "`n`n" + $SharedRules + "`n" + $FenceEnd)

Write-Host 'Generated templates/AGENTS.md, templates/CLAUDE.md, and templates/GEMINI.md.'
