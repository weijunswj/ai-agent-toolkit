$env:PATH = "/pwsh-mutated:$env:PATH"
$env:FIXTURE_PWSH_MUTATED = "1"
Push-Location src && Set-Location .. && Pop-Location
exit 0
