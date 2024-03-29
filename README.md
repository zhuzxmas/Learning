Use Github Actions to Automaticly Export Microsoft Teams Shifts Clockin Clockout data to Excel. This is for my own learning record:

# To use config file in Python
```
import configparser
config = configparser.ConfigParser()
config.read(['config.cfg'])
azure_settings = config['azure']
client_id = azure_settings['client_id']
```
注意：Microsoft Azure app `client_id` 是需要保密的，所以需要单独保存.
此处，我还使用了微信公众平台测试号，可以在下面的链接处获得。
https://mp.weixin.qq.com/debug/cgi-bin/sandboxinfo?action=showinfo&t=sandbox/index
第一次登录之后，最好再重新刷新一下页面，才可以获得正确的测试号的 `appid`, `secret`, `template id`, and 你自己的微信号的 `open id`。
以上信息都是保密的信息，所以可以通过保存到 Github Secrets里面，或者保存在本地的 config文件。

- 微信公众平台测试号，需要先获取 `access_token`, 再通过 `requests.post`把需要的信息发送到微信号里面就可以了。

# To check if file exists:
```
if os.path.exists('./config.cfg')
```
注意：Config文件里面的信息都是不带引号的，也没有array list, 所以需要通过下面的python语句实现将多个属性变成一个list:
```
azure_settings_scope['scope_list'].replace(' ','').split(',')
```

# To use Github Secrets:
- setup Github Secrets first in Github repository
- extract secrets in github workflow .yml file as below:
```
env:
   client_id : ${{secrets.CLIENT_ID}}
run: python -u main.py
```
Here, `client_id` is the variable that coudl be used in python code. `CLIENT_ID` is the secret variable saved in Github.

# To use MSAL API:
- install the MSAL lib for python:
```
pip install msal
from msal import PublicClientApplication
app = PublicClientApplication(
    client_id=client_id,
    authority = 'https://login.microsoftonline.com/common'
)

```

- 使用 `flow = app.initiate_device_flow(scopes=scope_list)`来创建一个登录请求，这种是用于在另一个设备上进行登录的过程，会反馈回来一个链接和登录验证码。
- 通过`result = app.acquire_token_by_device_flow(flow)`来获取 token, 结果就在 `result[`access_token`]`里面。
- 将这个token放到后面的各种操作的请求头里面就可以了。

# To use Microsoft Graph Beta API TimeCard for Teams Shifts:
https://learn.microsoft.com/en-us/graph/api/timecard-list?view=graph-rest-beta&tabs=http
这里是关于这个API的详细介绍，注意这个API可以使用 `ClockInEvent`来进行筛选，支持 `ge` greater than and equal to, `le` less than and equal to 查询。

# Dictionary to Json Format
```
json.dumps(learning_record, indent=4)
```

# To use Microsoft Graph API for Excel in OneDrive:
- Create a session: post `{'persistChanges': 'true'}` for `workbook/createSession`, 从返回值里获取 id: `session_id = json.loads($Return_Value$.text)['id']`
- Use session id for operations: put session id into http request headers `http_headers['Workbook-Session-Id'] = session_id`
- Close session: `request.post(***/workbook/closeSession)` 就可以了

# To use Github Action:
- 下面的`Schedule`是定义运行时间，是UTC时间（周三的8点22，也就是中国时间16:22），注意 Github Action 运行可能会稍微晚于这个时间几分钟，所以稍等一下，有点耐心（我开始的时候不知道，到时间没有运行，我还以为是我设置有问题）
- `workflow_dispatch`是也可以手动运行这个 Action
- `pip install -r requirements.txt` 是用来安装 requirements.txt 里面定义的第三方库
```
name: Python application

on:
  schedule:
    - cron:  '22 8 * * 3'
  #push:
  #  branches: [ "main" ]
  #pull_request:
  #  branches: [ "main" ]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  run-python-script:
    runs-on: ubuntu-latest

    steps:
    - name: checkout repo content
      uses: actions/checkout@v2

    - name: setup python
      uses: actions/setup-python@v4

    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

    - name: run main file
      env:
        client_id : ${{secrets.CLIENT_ID}}
        scope_list : ${{secrets.CLIENT_ID}}
        wx_APPID : ${{secrets.WX_APPID}}
        wx_SECRET : ${{secrets.WX_SECRET}}
        template_id : ${{secrets.TEMPLATE_ID}}
        openid : ${{secrets.OPENID}}
      run: python -u main.py
```