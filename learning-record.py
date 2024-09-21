import json, requests, datetime, os
from pandas import DataFrame
import funcLG

login_return = funcLG.func_login() # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
days_number = 7
# days_number = int(input("Please enter the number of days to extract the information from Teams Shifts API: \n"))

day_one = datetime.date.today()
day_seven_ago = day_one - datetime.timedelta(days=days_number)

endpoint = "https://graph.microsoft.com/beta/teams/28887499-6bc5-4b2f-a06c-25cc971e30ca/schedule/timeCards?$filter=(ClockInEvent/DateTime ge {}T00:00:00Z and ClockInEvent/DateTime le {}T23:59:59Z)".format(day_seven_ago,day_one)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
output = data['value']

if output != []: # if there is  learning records, continue below codes.
    time_format = "%Y-%m-%dT%H:%M:%S"

    learning_record = {'values':[]}
    learning_records = []
    # learning_records.append(['Person', 'Start Time', 'End Time', 'Duration', 'Notes'])

    for i in range(0, len(output)):
        output_temp = []
        learning_person = output[i]['createdBy']['user']['displayName'] # user name
        learning_start_time = datetime.datetime.strptime(output[i]['clockInEvent']['dateTime'][:-1].split('.')[0],time_format) # start time
        learning_start_time = learning_start_time + datetime.timedelta(hours=8) # convert to China Local Time
        learning_end_time = datetime.datetime.strptime(output[i]['clockOutEvent']['dateTime'][:-1].split('.')[0],time_format) # end time
        learning_end_time = learning_end_time + datetime.timedelta(hours=8) # convert to China Local Time
        break_event = output[i]['breaks']
        if break_event == []:
            learning_duration = round((learning_end_time - learning_start_time).seconds/60/60,2) # hours
        else:
            break_time = 0
            for ii in range(0,len(break_event)):
                break_time = break_time + round((datetime.datetime.strptime(break_event[ii]['end']['dateTime'][:-1].split('.')[0],time_format) - datetime.datetime.strptime(break_event[ii]['start']['dateTime'][:-1].split('.')[0],time_format)).seconds,0) # seconds
            learning_duration = round((learning_end_time - learning_start_time).seconds,0) # seconds
            learning_duration = round((learning_duration - break_time)/60/60,2) #hours
        if output[i]['notes'] == None:
            learning_notes = ''
        else:
            learning_notes = output[i]['notes']['content']
        output_temp.append(learning_person)
        output_temp.append(learning_start_time.strftime("%Y-%m-%d %H:%M:%S"))
        output_temp.append(learning_end_time.strftime("%Y-%m-%d %H:%M:%S"))
        output_temp.append(learning_duration)
        output_temp.append(learning_notes)
        learning_records.append(output_temp)
    learning_record['values'] = learning_records
    learning_record = json.dumps(learning_record, indent=4)
    # print("Below is the learning record: \n")
    # print(learning_record)
    # learning_records.to_csv('Learning_records.csv',mode='a',header=0, index=0, encoding='utf_8_sig') #Files\Learning\Learning_records.csv in OneDrive for Business CN

    onedrive_url = 'https://graph.microsoft.com/v1.0/'
    body_create_seesion = {'persistChanges': 'true'}
    body_create_seesion = json.dumps(body_create_seesion, indent=4)

    ### create a seesion id ###
    try:
        onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion)
    except:
        onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion, proxies=proxies)
    print('Create session:: status code is: ',onedrive_create_session.status_code)
    session_id = json.loads(onedrive_create_session.text)['id']

    ### Below are OneDrive Operations ###
    # onedrive_response = requests.get(onedrive_url + 'me/drive/root/children', headers = http_headers)
    http_headers['Workbook-Session-Id'] = session_id
    try:
        onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record)
    except:
        onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record, proxies=proxies)
    if (onedrive_response.status_code == 201):
        print('item added to Onedrive for Business Learning_records.xlsx')
        # data = {
        #     "code": {"value": "Run Succeed! Check Onedrive for Buiness Learning_record.xlsx"},
        # }
    else:
        print('Failed to add item to Onedrive for Business Learning_records.xlsx!')
        # data = {
        #     "code": {"value": "Failed, Check Github"},
        # }
    # openid = login_return['openid']
    # template_id = login_return['template_id']
    # funcLG.send_template_message(openid, template_id, data)    # 推送消息

    ### close session ###
    try:
        onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers)
    except:
        onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers, proxies=proxies)
    if onedrive_close_session.status_code == 204:
        print("Close session successfully!")
    else:
        print('Close session failed, status code is: ',onedrive_close_session.status_code)

        # onedrive_response = json.loads(onedrive_response.text)
        # items = onedrive_response['value']
        # for entries in range(len(items)):
        #     print(items[entries]['name'], '| item-id >', items[entries]['id']) # to show the files ID, which could be used in the onedrive API call
else:
    print('No learning records!')
