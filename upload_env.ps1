# upload_env.ps1
# Usage: ./upload_env.ps1
# Prerequisite: Run `npx vercel link` first to authenticate and link your project.

$envFile = ".env"

if (-Not (Test-Path $envFile)) {
    Write-Host ".env file not found!" -ForegroundColor Red
    exit
}

Write-Host "Starting upload of environment variables from .env to Vercel..." -ForegroundColor Cyan

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    # Skip comments and empty lines
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line -split '=', 2
        
        if ($parts.Length -eq 2) {
            $key = $parts[0].Trim()
            $value = $parts[1].Trim()
            
            Write-Host "Uploading $key..." -ForegroundColor Yellow
            
            # Upload to Development, Preview, and Production
            # Uses `npx vercel` so global install isn't needed.
            # Piping $value to stdin is how `vercel env add` accepts secrets without prompts.
            
            $targets = @("production", "preview", "development")
            
            foreach ($target in $targets) {
                # Note: This might prompt for 'overwrite' if key exists, but usually adds a new one.
                # To force plain add or handle output, we just run it.
                Write-Host "  -> $target" -NoNewline
                $value | npx vercel env add $key $target 2>$null | Out-Null
                Write-Host " [Done]" -ForegroundColor Green
            }
        }
    }
}

Write-Host "`nAll done! Don't forget to run 'npx vercel build' or trigger a redeploy in dashboard." -ForegroundColor Cyan
