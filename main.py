import json, requests, datetime, configparser, os
from pandas import DataFrame
from msal import PublicClientApplication

if os.path.exists('./config.cfg'):
    config = configparser.ConfigParser()
    config.read(['config.cfg', 'config.dev.cfg'])
    azure_settings = config['azure']
    wx_settings = config['wx_public_service']

    client_id = azure_settings['client_id']
    scope_list = azure_settings['scope_list'].replace(' ','').split(',')
    wx_APPID = wx_settings['wx_APPID']
    wx_SECRET = wx_settings['wx_SECRET']
    template_id = wx_settings['template_id']  # 在微信公众平台获取模板ID
    openid = wx_settings['openid']  # 用户的openid，可以在用户管理页面获取
    # https://mp.weixin.qq.com/debug/cgi-bin/sandboxinfo?action=showinfo&t=sandbox/index

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

    # 获取access_token
    def get_access_token():
        url = f"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={wx_APPID}&secret={wx_SECRET}"
        response = requests.get(url)
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
        response = requests.post(url, headers=headers, data=json.dumps(login_info))
        return response.json()

    # 示例数据
    data = {
        "code": {"value": flow['user_code']},
    }
    # 推送消息
    result1 = send_template_message(openid, template_id, data)
    print(result1)  # 打印推送结果

    # Ideally you should wait here, in order to save some unnecessary polling
    # input("Press Enter after signing in from another device to proceed, CTRL+C to abort.")

    result = app.acquire_token_by_device_flow(flow)  # By default it will block
        # You can follow this instruction to shorten the block time
        #    https://msal-python.readthedocs.io/en/latest/#msal.PublicClientApplication.acquire_token_by_device_flow
        # or you may even turn off the blocking behavior,
        # and then keep calling acquire_token_by_device_flow(flow) in your own customized loop

days_number = int(input("Please enter the number of days to extract the information from Teams Shifts API: \n"))
day_one = datetime.date.today()
day_seven_ago = day_one - datetime.timedelta(days=days_number)

endpoint = "https://graph.microsoft.com/beta/teams/28887499-6bc5-4b2f-a06c-25cc971e30ca/schedule/timeCards?$filter=(ClockInEvent/DateTime ge {}T00:00:00Z and ClockInEvent/DateTime le {}T23:59:59Z)".format(day_seven_ago,day_one)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
data = requests.get(endpoint, headers=http_headers, stream=False).json()
output = DataFrame(data['value'])

time_format = "%Y-%m-%dT%H:%M:%S"

learning_record = {'values':[]}
learning_records = []
# learning_records.append(['Person', 'Start Time', 'End Time', 'Duration', 'Notes'])

for i in range(0, len(output)):
    output_temp = []
    learning_person = output.values[i][8]['user']['displayName'] # user name
    learning_start_time = datetime.datetime.strptime(output.values[i][9]['dateTime'][:-1].split('.')[0],time_format) # start time
    learning_start_time = learning_start_time + datetime.timedelta(hours=8) # convert to China Local Time
    learning_end_time = datetime.datetime.strptime(output.values[i][10]['dateTime'][:-1].split('.')[0],time_format) # end time
    learning_end_time = learning_end_time + datetime.timedelta(hours=8) # convert to China Local Time
    learning_duration = round((learning_end_time - learning_start_time).seconds/60/60,2) # hours
    if output.values[i][7] == None:
        learning_notes = ''
    else:
        learning_notes = output.values[i][7]['content']
    output_temp.append(learning_person)
    output_temp.append(learning_start_time.strftime("%Y-%m-%d %H:%M:%S"))
    output_temp.append(learning_end_time.strftime("%Y-%m-%d %H:%M:%S"))
    output_temp.append(learning_duration)
    output_temp.append(learning_notes)
    learning_records.append(output_temp)
learning_record['values'] = learning_records
learning_record = json.dumps(learning_record, indent=4)
print(learning_record)
# learning_records.to_csv('Learning_records.csv',mode='a',header=0, index=0, encoding='utf_8_sig') #Files\Learning\Learning_records.csv in OneDrive for Business CN

### Below are OneDrive Operations ###
onedrive_url = 'https://graph.microsoft.com/v1.0/'
# onedrive_response = requests.get(onedrive_url + 'me/drive/root/children', headers = http_headers)
onedrive_response = requests.post(onedrive_url + 'me/drive/items/\
                                 01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', \
                                    headers = http_headers,\
                                        json = learning_record)
if (onedrive_response.status_code == 200):
    print('item added to Onedrive for Business Learning_records.xlsx')
    data = {
        "code": {"value": "Run Succeed! Check Onedrive for Buiness Learning_record.xlsx"},
    }
else:
    print('Failed!')
    data = {
        "code": {"value": "Failed, Check Github"},
    }
send_template_message(openid, template_id, data)    # 推送消息
    # onedrive_response = json.loads(onedrive_response.text)
    # items = onedrive_response['value']
    # for entries in range(len(items)):
    #     print(items[entries]['name'], '| item-id >', items[entries]['id']) # to show the files ID, which could be used in the onedrive API call

