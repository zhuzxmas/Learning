import json, requests, configparser, os
from msal import PublicClientApplication, ConfidentialClientApplication

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application
    config.read(['config.cfg'])
    azure_settings = config['azure']
    wx_settings = config['wx_public_service']
    proxy_settings = config['proxy_add']

    client_id = azure_settings['client_id']
    site_id = azure_settings['site_id']
    client_secret = azure_settings['client_secret']
    tenant_id = azure_settings['tenant_id']
    finance_section_id = azure_settings['finance_section_id']

    username = azure_settings['username']
    wx_APPID = wx_settings['wx_APPID']
    wx_SECRET = wx_settings['wx_SECRET']
    template_id = wx_settings['template_id']  # 在微信公众平台获取模板ID
    openid = wx_settings['openid']  # 用户的openid，可以在用户管理页面获取
    # https://mp.weixin.qq.com/debug/cgi-bin/sandboxinfo?action=showinfo&t=sandbox/index
    proxy_add = proxy_settings['proxy_add']
    # days_number = int(input("Please enter the number of days to extract the information from Teams Shifts API: \n"))
else: # to get this info from Github Secrets, for Github Action running application
    client_id = os.environ['client_id']
    site_id = os.environ['site_id']
    client_secret = os.environ['client_secret']
    tenant_id = os.environ['tenant_id']
    finance_section_id = os.environ['finance_section_id']
    username= os.environ['username']
    wx_APPID = os.environ['wx_APPID']
    wx_SECRET = os.environ['wx_SECRET']
    template_id = os.environ['template_id']
    openid = os.environ['openid']
    proxy_add = os.environ['proxy_add']

config.read(['config1.cfg']) # to get the scopes
azure_settings_scope = config['azure1']
scope_list = azure_settings_scope['scope_list'].replace(' ','').split(',')
# print( 'Scope List is: ', scope_list, '\n')

proxies = {
  "http": proxy_add,
  "https": proxy_add
}

def func_login():

    ### to create msal connection ###
    try:
        app = PublicClientApplication(
            client_id=client_id,
            authority = 'https://login.microsoftonline.com/common',
        )
    except:
        app = PublicClientApplication(
            client_id=client_id,
            authority = 'https://login.microsoftonline.com/common',
            proxies = proxies
        )

    result = None

    # Firstly, check the cache to see if this end user has signed in before...
    accounts = app.get_accounts(username=username)
    if accounts:
        result = app.acquire_token_silent(scope_list, account=accounts[0])

    if not result:
        print("No suitable token exists in cache. Let's get a new one from Azure AD.")

        flow = app.initiate_device_flow(scopes=scope_list)
        if "user_code" not in flow:
            raise ValueError(
                "Fail to create device flow. Err: %s" % json.dumps(flow, indent=4))

        # print(flow["message"])
        print(f"user_code is: {flow['user_code']}, login address: {flow['verification_uri']}")

        # 示例数据
        data = {
            "code": {"value": flow['user_code']},
        }
        # 推送消息
        # result1 = send_template_message(openid, template_id, data)
        # print(result1)  # 打印推送结果

        # Ideally you should wait here, in order to save some unnecessary polling
        # input("Press Enter after signing in from another device to proceed, CTRL+C to abort.")

        result = app.acquire_token_by_device_flow(flow)  # By default it will block
            # You can follow this instruction to shorten the block time
            #    https://msal-python.readthedocs.io/en/latest/#msal.PublicClientApplication.acquire_token_by_device_flow
            # or you may even turn off the blocking behavior,
            # and then keep calling acquire_token_by_device_flow(flow) in your own customized loop
    return {'result':result, 'proxies':proxies, 'finance_section_id':finance_section_id, 'openid':openid, 'template_id':template_id, 'site_id':site_id}

def func_login_secret():
    scopes = ['https://graph.microsoft.com/.default']
    # Create a preferably long-lived app instance which maintains a token cache.
    try:
        app = ConfidentialClientApplication(
            client_id=client_id,
            authority='https://login.microsoftonline.com/{}'.format(tenant_id),
            client_credential=client_secret,
        )
    except:
        app = ConfidentialClientApplication(
            client_id=client_id,
            authority='https://login.microsoftonline.com/{}'.format(tenant_id),
            client_credential=client_secret,
            proxies=proxies
        )
    # Acquire a token using the client credentials flow
    result = None

    # Firstly, checks the cache to see if there is a token it can use
    # If the token is available in the cache, it will return the token
    result = app.acquire_token_silent(scopes=scopes, account=None)

    if not result:
        result = app.acquire_token_for_client(scopes=scopes)

    if "access_token" in result:
        print("Access token got successfully!")
        # print("Access token:", result['access_token'])
    else:
        print(result.get("error"))
        print(result.get("error_description"))
        print(result.get("correlation_id"))  # You may need this when reporting a bug

    return {'result':result, 'proxies':proxies, 'site_id':site_id}

# 获取access_token
def get_access_token():
    url = f"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={wx_APPID}&secret={wx_SECRET}"
    try:
        response = requests.get(url)
    except:
        response = requests.get(url, proxies=proxies)

    data = response.json()
    access_token = data.get("access_token")
    return access_token

# 推送模板消息
def send_template_message(openid, template_id, data):
    access_token = get_access_token()
    url = f"https://api.weixin.qq.com/cgi-bin/message/template/send?access_token={access_token}"
    headers = {'Content-Type': 'application/json'}
    login_info = {
        "touser": openid,
        "template_id": template_id,
        "data": data
    }
    try:
        response = requests.post(url, headers=headers, data=json.dumps(login_info))
    except:
        response = requests.post(url, headers=headers, data=json.dumps(login_info),proxies=proxies)
    return response.json()


