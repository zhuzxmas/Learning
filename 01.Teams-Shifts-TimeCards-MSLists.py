import json, requests, datetime, os
from pandas import DataFrame
import funcLG

login_return = funcLG.func_login_secret() # to login into MS365 and get the return value
result = login_return['result']
proxies = login_return['proxies']
site_id = login_return['site_id']

days_number = 7
# days_number = int(input("Please enter the number of days to extract the information from Teams Shifts API: \n"))

day_one = datetime.date.today()
day_seven_ago = day_one - datetime.timedelta(days=days_number)

# to get the list id and relative info:
# visit Microsoft Graph API Reference Document https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0 for more information.
# if  list_url = 'https://xxx-my.sharepoint.com/personal/xxx_yyy_onmicrosoft_com/Lists/Learning_records/AllItems.aspx'
# then  endpoint_for_site_id = 'https://graph.microsoft.com/v1.0/sites/xxx-my.sharepoint.com:/personal/xxx_yyy_onmicrosoft_com/'
# data = requests.get(endpoint_for_site_id, headers=http_headers, stream=False).json()
# site_id = data['id'].split(',')[1]

# to get the list ID and username, which is needed for creating new lists item
endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists/Learning_records".format(site_id)
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False)
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies)
if data.status_code == 200:
    print('Successfully get the list info for Learning_records: \n')
list_id = data.json()['id']
user_name = data.json()['createdBy']['user']['displayName']
user_id = data.json()['createdBy']['user']['id']


######### below is to get MS Teams Shifts info ##########
# endpoint = "https://graph.microsoft.com/beta/teams/28887499-6bc5-4b2f-a06c-25cc971e30ca/schedule/timeCards?$filter=(ClockInEvent/DateTime ge {}T00:00:00Z and ClockInEvent/DateTime le {}T23:59:59Z)".format(day_seven_ago,day_one)
endpoint = "https://graph.microsoft.com/v1.0/teams/28887499-6bc5-4b2f-a06c-25cc971e30ca/schedule/timeCards?$filter=(ClockInEvent/DateTime ge {}T00:00:00Z and ClockInEvent/DateTime le {}T23:59:59Z)".format(day_seven_ago,day_one)
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
        try:
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

            # to Create a new Lists Item for Learning_records list:
            endpoint = "https://graph.microsoft.com/v1.0/sites/{}/lists/{}/items".format(site_id,list_id)
            http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'}
            new_item_data = {
              "fields": {
                "Title": learning_person,
                "field_1": learning_start_time.strftime("%Y-%m-%d %H:%M:%S"), # Start Time
                "field_2": learning_end_time.strftime("%Y-%m-%d %H:%M:%S"), # End Time
                "field_3": learning_duration, # Duration
                "field_4": learning_notes, # Notes
              }
            }
            new_item_data = json.dumps(new_item_data,indent=4)

            try:
                data = requests.post(endpoint, headers=http_headers, stream=False, data=new_item_data)
            except:
                data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, data=new_item_data)
            if data.status_code == 201:
                print('Successfully Created a new list item for Learning_records: \n')
            else:
                print('Failed, with http code: ' + data.status_code + '.\n')
        except:
            print('This Shift is not ended......')
else:
    print('No records found in the MS Teams Shift for the last 7 days. \n')

# ######### Excel Operation History (Not used anymore) ##########
# ### to create a new excel file ###
##    url = 'https://graph.microsoft.com/v1.0/me/drive/root/children'
##    headers = {
##        'Authorization': f'Bearer {ACCESS_TOKEN}',
##        'Content-Type': 'application/json'
##    }
##    body = json.dumps({
##        "name": file_name,
##        "file": {},
##        "@microsoft.graph.conflictBehavior": "rename",
##    })
##
##    response = requests.post(url, headers=headers, data=body)
##    response.raise_for_status()
##    return response.json()


#     onedrive_url = 'https://graph.microsoft.com/v1.0/'
#     body_create_seesion = {'persistChanges': 'true'}
#     body_create_seesion = json.dumps(body_create_seesion, indent=4)

#     ### create a seesion id ###
#     try:
#         onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion)
#     except:
#         onedrive_create_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/createSession', headers = http_headers, data = body_create_seesion, proxies=proxies)
#     print('Create session:: status code is: ',onedrive_create_session.status_code)
#     session_id = json.loads(onedrive_create_session.text)['id']

#     ### Below are OneDrive Operations ###
#     # onedrive_response = requests.get(onedrive_url + 'me/drive/root/children', headers = http_headers)

      ### to list the heaers ###
      # /me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/headerRowRange?$select=text

#     http_headers['Workbook-Session-Id'] = session_id
#     try:
#         onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record)
#     except:
#         onedrive_response = requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/tables/Table1/rows/add', headers = http_headers, data = learning_record, proxies=proxies)
#     if (onedrive_response.status_code == 201):
#         print('item added to Onedrive for Business Learning_records.xlsx')
#         # data = {
#         #     "code": {"value": "Run Succeed! Check Onedrive for Buiness Learning_record.xlsx"},
#         # }
#     else:
#         print('Failed to add item to Onedrive for Business Learning_records.xlsx!')
#         # data = {
#         #     "code": {"value": "Failed, Check Github"},
#         # }
#     # openid = login_return['openid']
#     # template_id = login_return['template_id']
#     # funcLG.send_template_message(openid, template_id, data)    # 推送消息

#     ### close session ###
#     try:
#         onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers)
#     except:
#         onedrive_close_session =  requests.post(onedrive_url + 'me/drive/items/01L7SVHITF3Z5SOUHNWNAJVRY7EBZG2EXY/workbook/closeSession', headers = http_headers, proxies=proxies)
#     if onedrive_close_session.status_code == 204:
#         print("Close session successfully!")
#     else:
#         print('Close session failed, status code is: ',onedrive_close_session.status_code)

#         # onedrive_response = json.loads(onedrive_response.text)
#         # items = onedrive_response['value']
#         # for entries in range(len(items)):
#         #     print(items[entries]['name'], '| item-id >', items[entries]['id']) # to show the files ID, which could be used in the onedrive API call
