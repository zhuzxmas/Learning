import json, requests
from msal import PublicClientApplication, ConfidentialClientApplication

client_secret = 'xxxx-xxxx-xxxx-xxxx-xxxx' # this is secret, you can not save it publicly
client_id = 'xxxx-xxxx-xxxx-xxxx-xxxx-xxxx' # it is also good to make this private
tenant_id = 'xxxx-xxxx-xxxx-xxxx-xxxx' # it is also good to make this private
scope_list = ['User.Read', 'Files.Read'] # you can add the premissions you want

# below func_login is to use PublicClientApplication method to get the access token
def func_login():
    app = PublicClientApplication(
        client_id=client_id,
        authority = 'https://login.microsoftonline.com/common',
        # proxies = proxies
    )

    # for proxies, it could be http://xxx.xxx.com:83/, or something similar if have

    # below uses device flow method, you can also use other method. go to https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token?tabs=python for more details
    flow = app.initiate_device_flow(scopes=scope_list)
    if "user_code" not in flow:
        raise ValueError(
            "Fail to create device flow. Err: %s" % json.dumps(flow, indent=4))
    print(f"user_code is: {flow['user_code']}, login address: {flow['verification_uri']}") # you need to login in.

    result = app.acquire_token_by_device_flow(flow)
    return {'result':result} # return a dictionary, easy to use

# below func_login is to use ConfidentialClientApplication method to get the access token
def func_login_secret():
    scopes = ['https://graph.microsoft.com/.default']

    # Create a preferably long-lived app instance which maintains a token cache.
    app = ConfidentialClientApplication(
        client_id=client_id,
        client_credential=client_secret,
        authority='https://login.microsoftonline.com/{}'.format(tenant_id),
        # proxies=proxies
    )
    # Acquire a token using the client credentials flow
    result = None

    # Firstly, checks the cache to see if there is a token it can use
    # If the token is available in the cache, it will return the token
    result = app.acquire_token_silent(scopes=scopes, account=None)

    # to get the access token
    if not result:
        result = app.acquire_token_for_client(scopes=scopes)

    if "access_token" in result:
        print("Access token got successfully!")
        # print("Access token:", result['access_token'])
    else:
        print(result.get("error"))
        print(result.get("error_description"))
        print(result.get("correlation_id"))  # You may need this when reporting a bug

    return {'result':result}


########################################
######### Example to login in with real user########
# below is to get the Pictures folder ID within OneDrive.

login_return = func_login() # you can also use to login into MS365 and get the return value info.
result = login_return['result']

# to get the Pictures folder id from OneDrive for Business:
endpoint = 'https://graph.microsoft.com/v1.0/me/drive/root/children'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    pass
    # below code is for scenarios with proxy.
    # data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
for i in range(0, len(data['value'])):
    if data['value'][i]['name'] == 'Pictures':
        Picture_folder_id = data['value'][i]['id']



##################################################
######### Example to login in by application automatically########
# to login into MS365 and get the return value

login_return = func_login_secret()
result = login_return['result']

# the endpoint shall not use /me, since there is no me (no user sign in), per MS Graph API requirement
endpoint = 'https://graph.microsoft.com/v1.0/users/'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}

try:
    data = requests.get(endpoint, headers=http_headers,
                        stream=False).json()
except:
    pass
    # data = requests.get(endpoint, headers=http_headers,
    #                     stream=False, proxies=proxies).json()
for i in range(0, len(data['value'])):
    if data['value'][i]['givenName'] == 'ANY USERNAME':
        user_id = data['value'][i]['id']