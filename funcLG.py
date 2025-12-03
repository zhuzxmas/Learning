import json
import requests
import configparser
import os
from msal import PublicClientApplication, ConfidentialClientApplication

config = configparser.ConfigParser()
# to check if local file config.cfg is available, for local application
if os.path.exists('./config.cfg'):
    config.read(['config.cfg'])
    azure_settings = config['azure']
    wx_settings = config['wx_public_service']
    proxy_settings = config['proxy_add']
    github_settings = config['Git_Hub']

    client_id = azure_settings['client_id']
    site__id_personal_z = azure_settings['site__id_personal_z']
    site__id_cmmas = azure_settings['site__id_cmmas']
    site__id_zhuzxself = azure_settings['site__id_zhuzxself']
    list__id_secret = azure_settings['list__id_secret']
    item_id = azure_settings['item_id']
    team_id_zhuzxself = azure_settings['team_id_zhuzxself']
    channel_id_Notification = azure_settings['channel_id_Notification']
    message_id_Login_Notification = azure_settings['message_id_Login_Notification']

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

    deeplx_settings = config['DeepLx']
    deeplx_secret_key = deeplx_settings['deeplx_secret_key']

    git_hub_token = github_settings['git_hub_token']


else:  # to get this info from Github Secrets, for Github Action running application
    client_id = os.environ['client_id']
    site__id_personal_z = os.environ['site__id_personal_z']
    site__id_cmmas = os.environ['site__id_cmmas']
    site__id_zhuzxself = os.environ['site__id_zhuzxself']
    list__id_secret = os.environ['list__id_secret']
    item_id = os.environ['item_id']
    team_id_zhuzxself = os.environ['team_id_zhuzxself']
    channel_id_Notification = os.environ['channel_id_Notification']
    message_id_Login_Notification = os.environ['message_id_Login_Notification']
    client_secret = os.environ['client_secret']
    tenant_id = os.environ['tenant_id']
    finance_section_id = os.environ['finance_section_id']
    username = os.environ['username']
    wx_APPID = os.environ['wx_APPID']
    wx_SECRET = os.environ['wx_SECRET']
    template_id = os.environ['template_id']
    openid = os.environ['openid']
    proxy_add = os.environ['proxy_add']
    deeplx_secret_key = os.environ['deeplx_secret_key']
    git_hub_token = os.environ['git_hub_token']

config.read(['config1.cfg'])  # to get the scopes
azure_settings_scope = config['azure1']
scope_list = azure_settings_scope['scope_list'].replace(' ', '').split(',')
# print( 'Scope List is: ', scope_list, '\n')

proxies = {
    "http": proxy_add,
    "https": proxy_add
}


def get_deeplx_key():
    return deeplx_secret_key


def get_refresh_token_from_SP(access_token, site__id_zhuzxself=site__id_zhuzxself, list__id_secret=list__id_secret, item_id=item_id):
    # GET /sites/{site-id}/lists/{list-id}/items
    # Replace these with your actual IDs.

    # Construct the URL
    url = f"https://graph.microsoft.com/v1.0/sites/{site__id_zhuzxself}/lists/{list__id_secret}/items/{item_id}"

    # Prepare headers
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # Make the Get request
    try:
        response = requests.get(url, headers=headers)
    except:
        response = requests.get(url, headers=headers, proxies=proxies)

    if response.status_code == 200:
        print("Refresh Token Obtained successfully!")
        Refresh_token = response.json()['fields']['Refresh_Token']
        Refresh_token_Obtained_Date = response.json()['fields']['Refresh_Token_Obtained_Date']
    else:
        Refresh_token = ''
        Refresh_token_Obtained_Date = ''
    return [Refresh_token, Refresh_token_Obtained_Date]


def get_access_token_with_refresh(refresh_token, client_id=client_id, tenant_id=tenant_id):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    data = {
        "client_id": client_id,
        "scope": "https://graph.microsoft.com/.default",
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    }

    try:
        response = requests.post(url, data=data)
    except:
        response = requests.post(url, data=data, proxies=proxies)

    if response.status_code == 200:
        print("Access Token Obtained successfully!")
        Access_token = response.json()['access_token']
    else:
        Access_token = ''
    return Access_token


def func_login():

    ### to create msal connection ###
    try:
        app = PublicClientApplication(
            client_id=client_id,
            authority='https://login.microsoftonline.com/common',
        )
    except:
        app = PublicClientApplication(
            client_id=client_id,
            authority='https://login.microsoftonline.com/common',
            proxies=proxies
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

        message_str1 = flow['user_code']
        # send_Teams_Channel_Message(message_str1)
        teams_message_power_automate_url = "https://default8bee2fb215ff45ad8a49aa967122d5.37.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/2e6f70b11999410f9e56ada71117e2a6/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=W-ge-P0EP6j07Rdu9MXkHw2gJPEcrSzN1s70-G-ISjQ"
        teams_message_power_automate_headers = {
            "Content-Type": "application/json"
        }

        teams_message_power_automate_data = {
            "results": message_str1
        }

        try:
            teams_message_power_automate_response = requests.post(teams_message_power_automate_url, headers=teams_message_power_automate_headers, json=teams_message_power_automate_data)
        except:
            teams_message_power_automate_response = requests.post(teams_message_power_automate_url, headers=teams_message_power_automate_headers, json=teams_message_power_automate_data, proxies=proxies)

        if teams_message_power_automate_response.status_code == 202:
            print("login code sent to Teams successfully, waiting for user to login......\n")
        
        # message_str2 = flow['verification_uri']
        # send_Teams_Channel_Message(message_str2)

        # 推送消息
        # result1 = send_template_message(openid, template_id, data)
        # print(result1)  # 打印推送结果

        # Ideally you should wait here, in order to save some unnecessary polling
        # input("Press Enter after signing in from another device to proceed, CTRL+C to abort.")

        result = app.acquire_token_by_device_flow(
            flow)  # By default it will block
        # You can follow this instruction to shorten the block time
        #    https://msal-python.readthedocs.io/en/latest/#msal.PublicClientApplication.acquire_token_by_device_flow
        # or you may even turn off the blocking behavior,
        # and then keep calling acquire_token_by_device_flow(flow) in your own customized loop
    return {'result': result, 'proxies': proxies, 'finance_section_id': finance_section_id, 'openid': openid, 'template_id': template_id, 'site__id_personal_z': site__id_personal_z}


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
        # You may need this when reporting a bug
        print(result.get("correlation_id"))

    return {'result': result, 'proxies': proxies, 'finance_section_id': finance_section_id, 'openid': openid, 'template_id': template_id, 'site__id_personal_z': site__id_personal_z, 'site__id_cmmas': site__id_cmmas}


def send_Teams_Channel_Message(message_str, team_id=team_id_zhuzxself, channel_id=channel_id_Notification, message_id=message_id_Login_Notification):

    login_return_app = func_login_secret()
    result_app = login_return_app['result']
    access_token_app = result_app['access_token']
    proxies = login_return_app['proxies']

    refresh_token = get_refresh_token_from_SP(access_token=access_token_app)
    access_token = get_access_token_with_refresh(refresh_token=refresh_token)

    # Construct the URL
    # POST /teams/{team-id}/channels/{channel-id}/messages
    url = f"https://graph.microsoft.com/v1.0/teams/{team_id}/channels/{channel_id}/messages/{message_id}/replies"

    # Prepare headers
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    fields_data = {
        "body": {
            "content": message_str
        }
    }

    # Make the Post request
    try:
        response = requests.post(
            url, headers=headers, data=json.dumps(fields_data))
    except:
        response = requests.post(
            url, headers=headers, data=json.dumps(fields_data), proxies=proxies)

    if response.status_code == 201:
        print("Message sent to Teams successfully!")
        return response.json()
    else:
        print(f"Error: {response.status_code}")
        print(f"Error message: {response.text}")
        return None


def update_sharepoint_list_item(fields_data, access_token, site_id=site__id_zhuzxself, list_id=list__id_secret, item_id=item_id):
    """
    Update a SharePoint list item using Microsoft Graph API

    Args:
        site_id (str): The SharePoint site ID
        list_id (str): The SharePoint list ID
        item_id (str): The SharePoint list item ID
        fields_data (dict): Dictionary containing the fields to update

    Returns:
        dict: Response from the API
    """

    # Construct the URL
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{item_id}/fields"
    # url_columns = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/columns"

    # Prepare headers
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # # Please Note: for referesh token, its length is more than 255, so in Microsoft Lists, this column shall be multi-line, not single line
    # fields_data = {
    #         "Refresh_Token": refresh_token,
    #         "Refresh_Token_Obtained_Date": today,
    #         "Refresh_Token_Last_Use_Date": today
    # }

    # Make the PATCH request
    try:
        response = requests.patch(
            url, headers=headers, data=json.dumps(fields_data))
    except:
        response = requests.patch(
            url, headers=headers, data=json.dumps(fields_data), proxies=proxies)

    if response.status_code == 200:
        print("Item updated successfully!")
        return response.json()
    else:
        print(f"Error: {response.status_code}")
        print(f"Error message: {response.text}")
        return None

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
        response = requests.post(url, headers=headers,
                                 data=json.dumps(login_info))
    except:
        response = requests.post(url, headers=headers,
                                 data=json.dumps(login_info), proxies=proxies)
    return response.json()
