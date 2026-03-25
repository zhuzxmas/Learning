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
    print("Refresh Token is still ok to use.\n")
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

endpoint = 'https://graph.microsoft.com/v1.0/me/drive/following'
http_headers = {'Authorization': 'Bearer ' + access_token_with_refresh_token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# for item in data['value'], if item['name'] ends with .jpg, .png, .jpeg, .heic, then it's a picture, and i will copy it to a new folder with the same name in the Pictures folder of OneDrive for Business to the Pictures folder in SharePoint document library.
for item in data['value']:
    if item['name'].lower().endswith(('.jpg', '.png', '.jpeg', '.heic')):
        picture_name = item['name']
        picture_id = item['id']
        picture_folder_name = item['webUrl'].split('/')[-2]

        # verify if the folder with the same name exists in the Pictures folder of SharePoint document library, if not, then create a new folder with the same name in the Pictures folder of SharePoint document library, and copy the picture to the new folder in the Pictures folder of SharePoint document library.
        # to get the site id of the SharePoint site:
        endpoint_site_id = 'https://graph.microsoft.com/v1.0/sites/cnmas.sharepoint.com:/sites/cmmas'
        try:
            data_site_id = requests.get(endpoint_site_id, headers=http_headers, stream=False).json()
        except:
            data_site_id = requests.get(endpoint_site_id, headers=http_headers, stream=False, proxies=proxies).json()
        site_id = data_site_id['id']

        # to Access the default drive (document library) for the given site.
        endpoint_drive_id = 'https://graph.microsoft.com/v1.0/sites/{}/drive/root/'.format(site_id)
        try:
            data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False).json()
        except:
            data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False, proxies=proxies).json()
        drive_id = data_drive_id['id']

        # to get the list folders in the Pictures folder of SharePoint document library:
        endpoint_folders = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, drive_id)
        try:
            data_folders = requests.get(endpoint_folders, headers=http_headers, stream=False).json()
        except:
            data_folders = requests.get(endpoint_folders, headers=http_headers, stream=False, proxies=proxies).json()
        folders = data_folders['value']
        for item in folders:
            if item['name'] == 'Family Life':
                Picture_folder_id = item['id']
                break
        
        # to list the items in the Pictures folder of SharePoint document library:
        endpoint_items = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, Picture_folder_id)
        try:
            Picture_folder_data = requests.get(endpoint_items, headers=http_headers, stream=False).json()
        except:
            Picture_folder_data = requests.get(endpoint_items, headers=http_headers, stream=False, proxies=proxies).json()
        Picture_folder_list = Picture_folder_data['value']

        # to check if the folder with the same name exists in the Pictures folder of SharePoint document library, if not, then create a new folder with the same name in the Pictures folder of SharePoint document library, and copy the picture to the new folder in the Pictures folder of SharePoint document library.
        folder_exists = False
        for item in Picture_folder_list:
            if item['name'] == picture_folder_name:
                folder_exists = True
                folder_id = item['id']
                break
        if not folder_exists:
            # to create a new folder with the same name in the Pictures folder of SharePoint document library:
            endpoint_create_folder = 'https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children'.format(site_id, Picture_folder_id)
            folder_data = {
                "name": picture_folder_name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "rename"
            }
            try:
                data_create_folder = requests.post(endpoint_create_folder, headers=http_headers, json=folder_data).json()
            except:
                data_create_folder = requests.post(endpoint_create_folder, headers=http_headers, json=folder_data, proxies=proxies).json()
            folder_id = data_create_folder['id']

        # to get the drive id of the Pictures folder of SharePoint document library:
        endpoint_drive_id = 'https://graph.microsoft.com/v1.0/sites/{}/drive/'.format(site_id)
        # endpoint_drive_id  = 'https://graph.microsoft.com/v1.0/sites/cnmas.sharepoint.com:/sites/cmmas'
        try:
            data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False).json()
        except:
            data_drive_id = requests.get(endpoint_drive_id, headers=http_headers, stream=False, proxies=proxies).json()
        drive_id = data_drive_id['id']

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
            data_copy_picture = requests.post(endpoint_copy_picture, headers=http_headers, json=copy_data).json()
        except: 
            data_copy_picture = requests.post(endpoint_copy_picture, headers=http_headers, json=copy_data, proxies=proxies).json()

# to unfollow a item: 
# POST https://graph.microsoft.com/v1.0/me/drive/items/{item-id}/unfollow

# to get the sub-folder within Pictures.
endpoint = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/children'.format(Picture_folder_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# to sort the pages by date, from latest to oldest ones:
data = data['value']
data = sorted(data, key=lambda x: datetime.fromisoformat(x['lastModifiedDateTime'].replace("Z", "+00:00")),reverse=True)
last_modified_folder_id = data[0]['id']
last_modified_folder_name = data[0]['name']

# to get the Favorites pictures I marked:

endpoint = 'https://graph.microsoft.com/v1.0/me/drive/items/{}/children?$select=id,name,isFavorite'.format(last_modified_folder_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

'''
https://graph.microsoft.com/v1.0/drives/{}/items/{}/children?$select=id,name,isFavorite
https://graph.microsoft.com/v1.0/users/{}/drives/{}/items/{}/children?$select=id,name,isFavorite

# tbd
'''