# scripts/download-grammars.ps1
# PowerShell script to download tree-sitter grammar files

Write-Host "`nDownloading tree-sitter grammar files...`n" -ForegroundColor Cyan

$grammarsDir = Join-Path $PSScriptRoot "..\grammars"

# Create grammars directory if it doesn't exist
if (-not (Test-Path $grammarsDir)) {
    New-Item -ItemType Directory -Path $grammarsDir | Out-Null
}

$grammars = @{
    "tree-sitter-python.wasm" = "https://cdn.jsdelivr.net/npm/tree-sitter-python@0.20.4/tree-sitter-python.wasm"
    "tree-sitter-java.wasm" = "https://cdn.jsdelivr.net/npm/tree-sitter-java@0.20.2/tree-sitter-java.wasm"
    "tree-sitter-c.wasm" = "https://cdn.jsdelivr.net/npm/tree-sitter-c@0.20.6/tree-sitter-c.wasm"
    "tree-sitter-cpp.wasm" = "https://cdn.jsdelivr.net/npm/tree-sitter-cpp@0.20.3/tree-sitter-cpp.wasm"
    "tree-sitter-javascript.wasm" = "https://cdn.jsdelivr.net/npm/tree-sitter-javascript@0.20.1/tree-sitter-javascript.wasm"
}

$successCount = 0
$failCount = 0

foreach ($grammar in $grammars.GetEnumerator()) {
    $filename = $grammar.Key
    $url = $grammar.Value
    $dest = Join-Path $grammarsDir $filename
    
    # Skip if already exists and is not empty
    if (Test-Path $dest) {
        $fileSize = (Get-Item $dest).Length
        if ($fileSize -gt 0) {
            $sizeKB = [math]::Round($fileSize / 1KB)
            Write-Host "[OK] $filename already exists ($sizeKB KB), skipping..." -ForegroundColor Green
            $successCount++
            continue
        }
        else {
            Remove-Item $dest
        }
    }
    
    try {
        Write-Host "Downloading $filename..." -ForegroundColor Yellow
        
        # Try with Invoke-WebRequest
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        
        $fileSize = (Get-Item $dest).Length
        $sizeKB = [math]::Round($fileSize / 1KB)
        Write-Host "[SUCCESS] Downloaded $filename ($sizeKB KB)" -ForegroundColor Green
        $successCount++
    }
    catch {
        Write-Host "[FAILED] Failed to download $filename" -ForegroundColor Red
        
        # Try alternate URL with unpkg
        $altUrl = $url -replace "cdn.jsdelivr.net/npm", "unpkg.com"
        try {
            Write-Host "  Trying alternate source..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri $altUrl -OutFile $dest -UseBasicParsing
            
            $fileSize = (Get-Item $dest).Length
            $sizeKB = [math]::Round($fileSize / 1KB)
            Write-Host "[SUCCESS] Downloaded $filename from alternate source ($sizeKB KB)" -ForegroundColor Green
            $successCount++
        }
        catch {
            Write-Host "[FAILED] Alternate source also failed" -ForegroundColor Red
            $failCount++
        }
    }
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "Successfully downloaded: $successCount/$($grammars.Count)" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "Failed downloads: $failCount" -ForegroundColor Red
}
Write-Host "Grammars saved to: $grammarsDir" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

if ($successCount -eq 0) {
    Write-Host "WARNING: No grammar files were downloaded!" -ForegroundColor Yellow
    Write-Host "The extension will fall back to regex-only detection.`n" -ForegroundColor Yellow
}