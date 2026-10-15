# scripts/generate-thumbnails.ps1
# Batch generate high-performance lightweight thumbnails for card images

param(
    [string]$SourceDir = "apps/web/public/cards",
    [string]$DestDir = "apps/web/public/cards/thumbs",
    [int]$TargetWidth = 360,
    [int]$Quality = 80,
    [int]$Limit = 0,
    [switch]$Force = $false
)

Add-Type -AssemblyName System.Drawing

$resolvedSource = (Resolve-Path $SourceDir).Path
if (!(Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}
$resolvedDest = (Resolve-Path $DestDir).Path

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Generating High-Performance Thumbnails for Card Images..." -ForegroundColor Cyan
Write-Host "  Source: $resolvedSource" -ForegroundColor Gray
Write-Host "  Target: $resolvedDest" -ForegroundColor Gray
Write-Host "  Spec: Width ${TargetWidth}px, JPEG Quality $Quality" -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

$allFiles = Get-ChildItem -Path $resolvedSource -Filter "*.png" | Where-Object { $_.DirectoryName -eq $resolvedSource }
if ($Limit -gt 0) {
    $allFiles = $allFiles | Select-Object -First $Limit
}

$totalCount = $allFiles.Count
Write-Host "Found $totalCount card image files to process." -ForegroundColor Green

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$processed = 0
$skipped = 0
$errors = 0
$origTotalBytes = [long]0
$thumbTotalBytes = [long]0

for ($i = 0; $i -lt $totalCount; $i++) {
    $file = $allFiles[$i]
    $destFile = Join-Path $resolvedDest ($file.BaseName + ".jpg")
    
    if (-not $Force -and (Test-Path $destFile)) {
        $destItem = Get-Item $destFile
        if ($destItem.LastWriteTime -ge $file.LastWriteTime -and $destItem.Length -gt 0) {
            $skipped++
            $origTotalBytes += $file.Length
            $thumbTotalBytes += $destItem.Length
            continue
        }
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $ms = New-Object System.IO.MemoryStream(,$bytes)
        $img = [System.Drawing.Image]::FromStream($ms)

        $targetHeight = [int]($img.Height * ($TargetWidth / $img.Width))
        $thumb = New-Object System.Drawing.Bitmap($TargetWidth, $targetHeight)
        $graph = [System.Drawing.Graphics]::FromImage($thumb)
        $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graph.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        
        $graph.DrawImage($img, 0, 0, $TargetWidth, $targetHeight)
        $thumb.Save($destFile, $codec, $encoderParams)

        $graph.Dispose()
        $thumb.Dispose()
        $img.Dispose()
        $ms.Dispose()

        $thumbItem = Get-Item $destFile
        $origTotalBytes += $file.Length
        $thumbTotalBytes += $thumbItem.Length
        $processed++

        if ($processed % 100 -eq 0 -or $processed -eq 1) {
            $pct = [math]::Round((($i + 1) / $totalCount) * 100, 1)
            Write-Host "Progress: [$($i + 1)/$totalCount] ($pct%) - Generated: $processed, Skipped: $skipped" -ForegroundColor Yellow
        }
    }
    catch {
        $errors++
        Write-Warning "Failed to process image: $($file.Name) - $_"
    }
}

$sw.Stop()
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Thumbnails generation finished!" -ForegroundColor Green
Write-Host "  Elapsed: $([math]::Round($sw.Elapsed.TotalSeconds, 2)) seconds" -ForegroundColor Gray
Write-Host "  Generated: $processed | Cached/Skipped: $skipped | Errors: $errors" -ForegroundColor Gray
if ($origTotalBytes -gt 0) {
    $origMB = [math]::Round($origTotalBytes / 1MB, 2)
    $thumbMB = [math]::Round($thumbTotalBytes / 1MB, 2)
    $savedPct = [math]::Round((1 - ($thumbTotalBytes / $origTotalBytes)) * 100, 1)
    Write-Host "  Original Size: $origMB MB -> Thumbnails Size: $thumbMB MB" -ForegroundColor Gray
    Write-Host "  Bandwidth Savings: $savedPct%" -ForegroundColor Green
}
Write-Host "======================================================================" -ForegroundColor Cyan
