import json
import requests
import datetime
import os
from pandas import DataFrame
from datetime import datetime
import funcLG
import z_Func_Update_GitHub_Repo_Secrects

# Replace these with your actual IDs.
SITE_ID = "a568f33d-7d99-4248-b7ea-a36369ed30e9"
LIST_ID = "4b92ad6b-0ce0-4e5d-a951-edb26b6acdab"
ITEM_ID = "1"

# to login into MS365 and get the return value info.
login_return = funcLG.func_login()
result = login_return['result']
refresh_token = result['refresh_token']
access_token = result['access_token']
proxies = login_return['proxies']

# save refresh token to Github Repo
OWNER = "zhuzxmas"
REPO = "Learning"
SECRET_NAME = "REFRESH_TOKEN"          # Replace with your secret name
z_Func_Update_GitHub_Repo_Secrects.update_Github_Repo_Secret(
    OWNER, REPO, SECRET_NAME, refresh_token)

# # to login into MS365 and get the return value info.
# login_return_secret = funcLG.func_login_secret()
# result_secret = login_return_secret['result']

# PATCH /sites/{site-id}/lists/{list-id}/items/{item-id}/fields
# https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0&tabs=http


def update_sharepoint_list_item(site_id, list_id, item_id, fields_data):
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
    # Get access token
    global access_token
    global proxies
    if access_token is None:
        # to login into MS365 and get the return value info.
        login_return = funcLG.func_login()
        result = login_return['result']
        access_token = result['access_token']
        proxies = login_return['proxies']
    else:
        pass

    # Construct the URL
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/items/{item_id}/fields"
    # url_columns = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_id}/columns"

    # Prepare headers
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # Make the PATCH request
    try:
        response = requests.patch(
            url, headers=headers, data=json.dumps(fields_data))
    except:
        response = requests.patch(
            url, headers=headers, data=json.dumps(fields_data), proxies=proxies)

    if response.status_code == 200:
        print("Item updated successfully into SharePoint List!")
        return response.json()
    else:
        print(f"Error: {response.status_code}")
        print(f"Error message: {response.text}")
        return None


# Example usage:
if __name__ == "__main__":

    # Get today's date in ISO format (YYYY-MM-DD or ISO 8601 format)
    # today = datetime.now().isoformat()
    today = datetime.now().strftime('%Y-%m-%d')

    # Data to update
    # Please Note: for referesh token, its length is more than 255, so in Microsoft Lists, this column shall be multi-line, not single line
    fields_data = {
            "Refresh_Token": refresh_token,
            "Refresh_Token_Obtained_Date": today,
            "Refresh_Token_Last_Use_Date": today
    }


    # Update the SharePoint list item
    result = update_sharepoint_list_item(
        SITE_ID, LIST_ID, ITEM_ID, fields_data)

    # if result:
        # print("Updated item:", result)
