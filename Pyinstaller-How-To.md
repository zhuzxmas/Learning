### Create Virtual Environment
```
python -m venv 12365
```

激活环境：
```
12365/Script/activate
```

退出环境：
```
deactivate
```

### Pyinstaller打包
```
pip install pyinstaller  --proxy http://internet.ford.com:83
pip install -r requirements.txt  --proxy http://internet.ford.com:83

pyinstaller.exe  .\12365auto_main.py
```

创建出来一个 `spec`文件，然后编辑这个文件，在datas里面： 将pacfile这个文件打包到根目录(`.`)，实际是会被放到`_internal`文件夹下，所以代码里面也需要体现这一点。

```
a = Analysis(
    ['12365auto_main.py'],
    pathex=[],
    binaries=[],
    datas=[('pacfile','.'),('category_list.json','.')],
```

```
pyinstaller.exe  .\12365auto_main.spec
```

### 将文件load为 JSON 格式：
```
with open(r'./_internal/category_list.json',encoding= 'utf-8') as ff:
category_list = json.load(ff)
```

### 将字符串 load 为 JSON 格式：
```
category_list = json.loads(res.text.split('= ')[-1]) # to load string to json, json.load is for file loading
```