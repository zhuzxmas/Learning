import json, requests
from msal import ConfidentialClientApplication
from msal import PublicClientApplication

client_id = '9090f5d5-546e-4a88-aeca-c6a58ba42552'

app = PublicClientApplication(
    client_id=client_id,
    authority = 'https://login.microsoftonline.com/common'
)

result = None

# Firstly, check the cache to see if this end user has signed in before...
accounts = app.get_accounts(username='zhuzx@cnmas.onmicrosoft.com')
if accounts:
    result = app.acquire_token_silent(["User.Read"], account=accounts[0])

if not result:
    print("No suitable token exists in cache. Let's get a new one from Azure AD.")

    flow = app.initiate_device_flow(scopes=["User.Read"])
    if "user_code" not in flow:
        raise ValueError(
            "Fail to create device flow. Err: %s" % json.dumps(flow, indent=4))

    print(flow["message"])
    print(f"user_code is: {flow['user_code']}, login address: {flow['verification_uri']}")

    # Ideally you should wait here, in order to save some unnecessary polling
    # input("Press Enter after signing in from another device to proceed, CTRL+C to abort.")

    result = app.acquire_token_by_device_flow(flow)  # By default it will block
        # You can follow this instruction to shorten the block time
        #    https://msal-python.readthedocs.io/en/latest/#msal.PublicClientApplication.acquire_token_by_device_flow
        # or you may even turn off the blocking behavior,
        # and then keep calling acquire_token_by_device_flow(flow) in your own customized loop


################################
# This is for login with interactive GUI:
# accounts = app.get_accounts()
# if accounts:
#     # If so, you could then somehow display these accounts and let end user choose
#     print("Pick the account you want to use to proceed:")
#     for a in accounts:
#         print(a["username"])
#     # Assuming the end user chose this one
#     chosen = accounts[0]
#     # Now let's try to find a token in cache for this account
#     result = app.acquire_token_silent(["User.Read"], account=chosen)
# if not result:
#     # So no suitable token exists in cache. Let's get a new one from Azure AD.
#     result = app.acquire_token_interactive(scopes=["User.Read"])
# if "access_token" in result:
#     print(result["access_token"])  # Yay!
# else:
#     print(result.get("error"))
#     print(result.get("error_description"))
#     print(result.get("correlation_id"))  # You may need this when reporting a bug

################################################################
# this part is for confidential client

# tenant_id = '8bee2fb2-15ff-45ad-8a49-aa967122d537'

# msal_authority = f'https://login.microsoftonline.com/{tenant_id}'
# msal_scope = ['https://graph.microsoft.com/.default']

# msal_app = ConfidentialClientApplication(
#     client_id = client_id,
#     client_credential = client_secret,
#     authority = msal_authority,
#     )

# result = msal_app.acquire_token_silent(
#     scopes=msal_scope,
#     account=None,
#     )

# if not result:
#     result = msal_app.acquire_token_for_client(scopes=msal_scope)

# if result:
#     access_token = result['access_token']
#     print(access_token)
# else:
#     raise Exception('Access token not found')

# headers = {
#     'Authorization': f'Bearer {access_token}',
#     'Content-Type': 'application/json',
#     }

# response = requests.get(
#     url= 'https://graph.microsoft.com/v1.0/users',
#     headers=headers,
# )

# print(json.dumps(response.json(),indent=4))

################################################################