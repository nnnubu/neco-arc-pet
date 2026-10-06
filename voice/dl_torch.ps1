# CUDA torch chunked parallel download (4 connections + retry, resume-capable)
$ErrorActionPreference = "Continue"
$url = "https://mirrors.aliyun.com/pytorch-wheels/cu124/torch-2.6.0%2Bcu124-cp310-cp310-win_amd64.whl"
$total = 2532341467
$parts = 4
$dir = "C:\Users\nnnubu\Desktop\neco arc\_torch_dl"
$outFile = "$dir\torch-2.6.0+cu124-cp310-cp310-win_amd64.whl"
New-Item $dir -ItemType Directory -Force | Out-Null
$chunk = [math]::Ceiling($total / $parts)

for ($i = 0; $i -lt $parts; $i++) {
    $start = $i * $chunk
    $end = [math]::Min(($i + 1) * $chunk - 1, $total - 1)
    $partFile = "$dir\p$i"
    Start-Process -FilePath "curl.exe" -ArgumentList @("-s", "-C", "-", "--retry", "20", "--retry-delay", "5", "-o", $partFile, "-r", "$start-$end", $url) -WindowStyle Hidden -PassThru | Out-Null
}
Write-Output "started 4 curl processes with retry"

while ((Get-Process curl -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    Start-Sleep -Seconds 10
}
Write-Output "all curl finished"

$ok = $true
for ($i = 0; $i -lt $parts; $i++) {
    $pf = "$dir\p$i"
    if (-not (Test-Path $pf)) { $ok = $false; Write-Output "p$i MISSING"; continue }
    $sz = (Get-Item $pf).Length
    Write-Output "p$i size=$sz"
    $expected = if ($i -lt $parts - 1) { $chunk } else { $total - ($parts - 1) * $chunk }
    if ([math]::Abs($sz - $expected) -gt 1024) { $ok = $false }
}

if ($ok) {
    cmd /c "copy /b `"$dir\p0`"+`"$dir\p1`"+`"$dir\p2`"+`"$dir\p3`" `"$outFile`"" | Out-Null
    $sz = (Get-Item $outFile -ErrorAction SilentlyContinue).Length
    if ($sz -eq $total) {
        "MERGED OK size=$sz"
        $b = [System.IO.File]::ReadAllBytes($outFile)[0..1]
        if ($b[0] -eq 0x50 -and $b[1] -eq 0x4B) { "ZIP HEADER OK" }
    } else {
        "MERGED FAIL size=$sz expected=$total"
    }
} else {
    "SOME PARTS INCOMPLETE - run script again to resume"
}
