# 管理员修复脚本：停用网易 UU / TAP 等第三方网络过滤驱动，并复测出站连通
$log = "C:\Users\nnnubu\Desktop\neco arc\猫姬桌宠-成品\voice\_fix_net_result.txt"
"开始时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $log -Encoding utf8
foreach ($svc in @('nfwfp','uuwfp','aavktap6','tap0901','orayboxvpn')) {
  sc.exe stop $svc 2>&1 | Out-File $log -Append -Encoding utf8
  Start-Sleep 1
}
"--- 停用后状态 ---" | Out-File $log -Append -Encoding utf8
foreach ($svc in @('nfwfp','uuwfp','aavktap6','tap0901')) {
  $s = sc.exe query $svc 2>&1 | Select-String "STATE"
  "$svc : $s" | Out-File $log -Append -Encoding utf8
}
"--- 复测 HTTPS ---" | Out-File $log -Append -Encoding utf8
curl.exe -s -o NUL -w "baidu_https=%{http_code} time=%{time_total}s" --max-time 8 https://www.baidu.com 2>&1 | Out-File $log -Append -Encoding utf8
"--- 复测 DNS (223.5.5.5) ---" | Out-File $log -Append -Encoding utf8
nslookup api.siliconflow.cn 223.5.5.5 2>&1 | Out-File $log -Append -Encoding utf8
"--- 复测 Python getaddrinfo ---" | Out-File $log -Append -Encoding utf8
& "C:\Users\nnnubu\Desktop\neco arc\猫姬桌宠-成品\voice-env310\Scripts\python.exe" -c "import socket; print('py_dns_ok:', socket.gethostbyname('api.siliconflow.cn'))" 2>&1 | Out-File $log -Append -Encoding utf8
"结束时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $log -Append -Encoding utf8
