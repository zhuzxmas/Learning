import json, requests, datetime
from pandas import DataFrame
from msal import ConfidentialClientApplication
from msal import PublicClientApplication

client_id = '9090f5d5-546e-4a88-aeca-c6a58ba42552'
scope_list = ["User.Read","User.Read.All","User.ReadWrite.All",
                        "Schedule.Read.All","Schedule.ReadWrite.All"]

app = PublicClientApplication(
    client_id=client_id,
    authority = 'https://login.microsoftonline.com/common'
)

result = None

# Firstly, check the cache to see if this end user has signed in before...
accounts = app.get_accounts(username='zhuzx@cnmas.onmicrosoft.com')
if accounts:
    result = app.acquire_token_silent(scope_list, account=accounts[0])

if not result:
    print("No suitable token exists in cache. Let's get a new one from Azure AD.")

    flow = app.initiate_device_flow(scopes=scope_list)
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

day_one = datetime.date.today()
day_seven_ago = day_one - datetime.timedelta(days=7)

endpoint = "https://graph.microsoft.com/beta/teams/28887499-6bc5-4b2f-a06c-25cc971e30ca/schedule/timeCards?$filter=(ClockInEvent/DateTime ge {}T00:00:00Z and ClockInEvent/DateTime le {}T23:59:59Z)".format(day_seven_ago,day_one)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
data = requests.get(endpoint, headers=http_headers, stream=False).json()
output = DataFrame(data['value'])
print(output)
# output.to_csv('output.csv',mode='a',header=0, index=0, encoding='utf_8_sig')
