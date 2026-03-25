import json, requests, datetime, os
from pandas import DataFrame
from datetime import datetime, timezone
import funcLG

login_return_secret = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result_secret = login_return_secret['result']
access_token_secret = result_secret['access_token']
login_return_refresh = funcLG.get_refresh_token_from_SP(access_token_secret)
refresh_token = login_return_refresh[0]
refresh_token_obtained_date_str = login_return_refresh[1]
proxies = login_return_secret['proxies']

# Parse the datetime string into a timezone-aware datetime object...
refresh_token_obtained_date_date = datetime.fromisoformat(refresh_token_obtained_date_str.replace('Z', '+00:00'))

# Get current time in UTC (timezone-aware)
now_date = datetime.now(timezone.utc)

# Calculate the difference
delta_days_date = now_date - refresh_token_obtained_date_date 

# Get the number of days (as a float, but we can use .days for whole days)
delta_days_number = delta_days_date.days
today = datetime.now().strftime('%Y-%m-%d')

# Check condition
if delta_days_number < 40:
    print("\nRefresh Token is still ok to use.\n")
    access_token_with_refresh_token = funcLG.get_access_token_with_refresh(refresh_token=refresh_token)
else:
    print("Refresh Token will expire soon, let's update it now...\n")
    login_return = funcLG.func_login() # to login into MS365 and get the return value info.
    result_login = login_return['result']
    refresh_token = result_login['refresh_token']
    access_token_with_refresh_token = result_login['access_token']

    # update the new refresh token to the SharePoint list for future use:
    fields_data = {
             "Refresh_Token": refresh_token,
             "Refresh_Token_Obtained_Date": today,
             "Refresh_Token_Last_Use_Date": today
     }

    funcLG.update_sharepoint_list_item(fields_data=fields_data, access_token=access_token_secret)


# to get the Pictures folder id from OneDrive for Business:

endpoint = 'https://graph.microsoft.com/v1.0/me/drive/following?$top=100'
http_headers = {'Authorization': 'Bearer ' + access_token_with_refresh_token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    following_data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    following_data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# to get the site id of the SharePoint site:
endpoint_site_id = 'https://graph.microsoft.com/v1.0/sites/cnmas.sharepoint.com:/sites/cmmas'
try:
    data_site_id = requests.get(endpoint_site_id, headers=http_headers, stream=False).json()
except:
    data_site_id = requests.get(endpoint_site_id, headers=http_headers, stream=False, proxies=proxies).json()
site_id = data_site_id['id']

# to Access the default drive (document library) for the given site.
endpoint_Doc_drive_id = 'https://graph.microsoft.com/v1.0/sites/{}/drive/root/'.format(site_id)
try:
    Doc_data_drive_id = requests.get(endpoint_Doc_drive_id, headers=http_headers, stream=False).json()
except:
    Doc_data_drive_id = requests.get(endpoint_Doc_drive_id, headers=http_headers, stream=False, proxies=proxies).json()
Doc_drive_id = Doc_data_drive_id['id']

# to get the Family Life folder id of SharePoint document library:
endpoint_folders = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, Doc_drive_id)
try:
    data_folders = requests.get(endpoint_folders, headers=http_headers, stream=False).json()
except:
    data_folders = requests.get(endpoint_folders, headers=http_headers, stream=False, proxies=proxies).json()
folders = data_folders['value']
for item in folders:
    if item['name'] == 'Family Life':
        Family_Life_folder_id = item['id']
        break
    
# to get the drive id of the Pictures folder of SharePoint document library:
endpoint_drive_id = 'https://graph.microsoft.com/v1.0/sites/{}/drive/'.format(site_id)
try:
    data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False)
except:
    data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False, proxies=proxies)
if data_drive_id.status_code == 200:
    print("Successfully get the drive id of the Pictures folder of SharePoint document library.")
else:
    print("Failed to get the drive id of the Pictures folder of SharePoint document library. Status code: {}, Response: {}".format(data_drive_id.status_code, data_drive_id.text))
drive_id = data_drive_id.json()['id']

# for item in following_data['value'], if item['name'] ends with .jpg, .png, .jpeg, .heic, then it's a picture, and i will copy it to a new folder with the same name in the Pictures folder of OneDrive for Business to the Pictures folder in SharePoint document library.
for item in following_data['value']:
    if item['name'].lower().endswith(('.jpg', '.png', '.jpeg', '.heic')) and '微信经营账户' not in item['name']:
        picture_name = item['name']
        picture_id = item['id']
        picture_folder_name = item['webUrl'].split('/')[-2]

        # to list the items in the Family Life folder of SharePoint document library:
        endpoint_items = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, Family_Life_folder_id)
        try:
            Family_Life_Children_data = requests.get(endpoint_items, headers=http_headers, stream=False).json()
        except:
            Family_Life_Children_data = requests.get(endpoint_items, headers=http_headers, stream=False, proxies=proxies).json()
        Family_Life_Children_List = Family_Life_Children_data['value']

        # to check if the folder with the same name exists in the Pictures folder of SharePoint document library, 
        # if not, then create a new folder with the same name in the Pictures folder of SharePoint document library, 
        # and copy the picture to the new folder in the Pictures folder of SharePoint document library.
        folder_exists = False
        for chidren_folder_name in Family_Life_Children_List:
            if chidren_folder_name['name'] == picture_folder_name:
                folder_exists = True
                folder_id = chidren_folder_name['id']
                print("Folder {} already exists in the Pictures folder of SharePoint document library.".format(picture_folder_name))
                break
        if not folder_exists:
            # to create a new folder with the same name in the Pictures folder of SharePoint document library:
            endpoint_create_folder = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, Family_Life_folder_id)
            folder_data = {
                "name": picture_folder_name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "rename"
            }
            try:
                data_create_folder = requests.post(endpoint_create_folder, headers=http_headers, json=folder_data)
            except:
                data_create_folder = requests.post(endpoint_create_folder, headers=http_headers, json=folder_data, proxies=proxies)
            if data_create_folder.status_code == 201:
                print("Folder {} is created successfully.".format(picture_folder_name))
            else:
                print("Failed to create folder {}. Status code: {}, Response: {}".format(picture_folder_name, data_create_folder.status_code, data_create_folder.text))
            folder_id = data_create_folder.json()['id']

        # to copy the picture to the new folder in the Pictures folder of SharePoint document library:
        endpoint_copy_picture = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/copy'.format(picture_id)
        copy_data = {
            "parentReference": {
                "driveId": drive_id,
                "id": folder_id
            },
            "name": picture_name
        }
        try:
            data_copy_picture = requests.post(endpoint_copy_picture, headers=http_headers, json=copy_data)
        except: 
            data_copy_picture = requests.post(endpoint_copy_picture, headers=http_headers, json=copy_data, proxies=proxies)
        if data_copy_picture.status_code == 202:
            print("Picture {} is copied successfully.".format(picture_name))
        else:
            print("Failed to copy picture {}. Status code: {}, Response: {}".format(picture_name, data_copy_picture.status_code, data_copy_picture.text))

        # to unfollow a item: 
        # POST https://graph.microsoft.com/v1.0/me/drive/items/{picture-id}/unfollow
        endpoint_unfollow = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/unfollow'.format(picture_id)
        try:
            data_unfollow = requests.post(endpoint_unfollow, headers=http_headers)
        except:
            data_unfollow = requests.post(endpoint_unfollow, headers=http_headers, proxies=proxies)
        if data_unfollow.status_code == 204:
            print("Picture {} is unfollowed successfully.".format(picture_name))
        else:
            print("Failed to unfollow picture {}. Status code: {}, Response: {}".format(picture_name, data_unfollow.status_code, data_unfollow.text))