# CUDA torch 分块并行下载（8 连接加速，阿里云镜像）
# 用法: powershell -ExecutionPolicy Bypass -File dl_torch.ps1
$ErrorActionPreference = "Continue"
$url = "https://mirrors.aliyun.com/pytorch-wheels/cu124/torch-2.6.0%2Bcu124-cp310-cp310-win_amd64.whl"
$total = 2532341467
$parts = 8
$dir = "C:\Users\nnnubu\Desktop\neco arc\_torch_dl"
$outFile = "$dir\torch-2.6.0+cu124-cp310-cp310-win_amd64.whl"
New-Item $dir -ItemType Directory -Force | Out-Null
$chunk = [math]::Ceiling($total / $parts)

# 启动 8 个并行下载（每段独立文件，curl 自动续传 -C -）
$jobs = @()
for ($i = 0; $i -lt $parts; $i++) {
    $start = $i * $chunk
    $end = [math]::Min(($i + 1) * $chunk - 1, $total - 1)
    $partFile = "$dir\part$i"
    $jobs += Start-Job -ScriptBlock {
        param($u, $s, $e, $pf, $idx)
        $code = curl.exe -s -C - -o $pf -r "$s-$e" $u
        $sz = (Get-Item $pf -ErrorAction SilentlyContinue).Length
        "part$idx done size=$sz curl=$code"
    } -ArgumentList $url, $start, $end, $partFile, $i
}
# 等待完成
$jobs | Wait-Job | Out-Null
$results = $jobs | Receive-Job
$jobs | Remove-Job
$results | Out-File "$dir\dl_result.txt" -Encoding UTF8

# 校验各段大小
$ok = $true
for ($i = 0; $i -lt $parts; $i++) {
    $pf = "$dir\part$i"
    if (-not (Test-Path $pf)) { $ok = $false; continue }
    $sz = (Get-Item $pf).Length
    $expected = if ($i -lt $parts - 1) { $chunk } else { $total - ($parts - 1) * $chunk }
    if ([math]::Abs($sz - $expected) -gt 1024) { $ok = $false }
}

# 合并
if ($ok) {
    cmd /c "copy /b `"$dir\part0`"+`"$dir\part1`"+`"$dir\part2`"+`"$dir\part3`"+`"$dir\part4`"+`"$dir\part5`"+`"$dir\part6`"+`"$dir\part7`" `"$outFile`"" | Out-Null
    $sz = (Get-Item $outFile -ErrorAction SilentlyContinue).Length
    if ($sz -eq $total) {
        "MERGED OK size=$sz"
        # 校验文件头（ONNX 无关，wheel 是 zip，检查 PK 头）
        $b = [System.IO.File]::ReadAllBytes($outFile)[0..1]
        if ($b[0] -eq 0x50 -and $b[1] -eq 0x4B) { "ZIP HEADER OK" }
    } else {
        "MERGED FAIL size=$sz expected=$total"
    }
} else {
    "SOME PARTS INCOMPLETE - run script again to resume"
    for ($i = 0; $i -lt $parts; $i++) {
        $pf = "$dir\part$i"
        if (Test-Path $pf) { "part$i size=$((Get-Item $pf).Length)" } else { "part$i MISSING" }
    }
}
