# 只显示当前文件夹名称，隐藏显示全部的绝对路径地址
function Prompt {
    # Get only the last folder name of the current directory
    $currentFolder = Split-Path -Leaf -Path $PWD

    # Customize the prompt (e.g., add a symbol or color)
    Write-Host "$currentFolder" -NoNewline -ForegroundColor Green
    return "> "
}

# 配置 PowerShell 中的 python 版本，先指定，再创建新的虚拟环境，再直接激活虚拟环境
# install python3.12 first, then enable this one to activate it, to create a vevn, then disable this one
# Set-Alias python C:\Users\zzhu25\AppData\Local\Programs\Python\Python312\python.exe

# 激活虚拟环境
& "C:\Users\zzhu25\OneDrive - azureford\important-docs\00.PythonScripts\base\Scripts\Activate.ps1"

function sshnahpc {
  ssh zzhu25@hpchdp2e.hpc.ford.com
}

function sshcnhpc {
  ssh zzhu25@hpccnp2e.hpccn.ford.com
}
