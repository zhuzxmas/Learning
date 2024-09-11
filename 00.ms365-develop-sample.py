import json, requests, configparser, os
from msal import PublicClientApplication, ConfidentialClientApplication

client_id = 'xxxx-xxxx-xxxx-xxxx-xxxx-xxxx' # it is also good to make this private
client_secret = 'xxxx-xxxx-xxxx-xxxx-xxxx' # this is secret, you can not save it publicly
tenant_id = 'xxxx-xxxx-xxxx-xxxx-xxxx' # it is also good to make this private
scope_list = ['User.Read', 'Files.Read']

def func_login():
    app = PublicClientApplication(
        client_id=client_id,
        authority = 'https://login.microsoftonline.com/common',
        # proxies = proxies
    )

    flow = app.initiate_device_flow(scopes=scope_list)
    if "user_code" not in flow:
        raise ValueError(
            "Fail to create device flow. Err: %s" % json.dumps(flow, indent=4))
    print(f"user_code is: {flow['user_code']}, login address: {flow['verification_uri']}") # you need to login in.

    result = app.acquire_token_by_device_flow(flow)
    return {'result':result}

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

