import json, requests, datetime, os
from pandas import DataFrame
from datetime import datetime
import funcLG

login_return = funcLG.func_login() # to login into MS365 and get the return value info.
result = login_return['result']
proxies = login_return['proxies']

# create sharing link can be done via Microsoft Graph: endpoint is 'https://graph.microsoft.com/v1.0/me/drive/items/{item-id}/createlink', check the API document in 'https://learn.microsoft.com/en-us/graph/api/driveitem-createlink?view=graph-rest-1.0'. a

endpoint = 'https://graph.microsoft.com/v1.0/sites?search={cnmas}'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
output = data['value']

### to get the OneNote info:
endpoint = 'https://graph.microsoft.com/v1.0/users/{user-id}/onenote/notebooks/'

# to get the site id for below SP address:
for i in range(0,len(output)):
    if output[i]['webUrl'] == 'https://cnmas.sharepoint.com/sites/cmmas':
        site_id = output[i]['id'].split(',')[1]

# to list site pages:
endpoint = 'https://graph.microsoft.com/v1.0/sites/{}/pages'.format(site_id)
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()

# to sort the pages by date, from latest to oldest:
data = data['value']
data = sorted(data, key=lambda x: datetime.fromisoformat(x['createdDateTime'].replace("Z", "+00:00")),reverse=True)
for i in range(len(data)):
    print(data[i]['title'])

# to create a new page in SharePoint:
endpoint = 'https://graph.microsoft.com/v1.0/sites/{}/pages'.format(site_id)
new_page_address_url = input('Please input the URL to create a new page: \n')
new_page_title = input('Please enter the title of the new page: \n')
page_body = {
  "@odata.type": "#microsoft.graph.sitePage",
  "name": "{}.aspx".format(new_page_address_url),
  "title": "{}".format(new_page_title),
  "pageLayout": "article",
  "showComments": True,
  "showRecommendedPages": True,
  "titleArea": {
    "layout": "imageAndTitle",
    "showAuthor": True,
    "showPublishedDate": True,
    "showTextBlockAboveTitle": False,
    "textAboveTitle": "TEXT ABOVE TITLE",
    "textAlignment": "left",
    "title": "{}".format(new_page_title)},
    "publishingState": {"level": "published"},
    "canvasLayout": {
    "horizontalSections": [
      {
        "layout": "oneColumn",
        "id": "1",
        "emphasis": "none",
        "columns": [
          {
            "id": "1",
            "width": 12,
            "webparts": [
              {
                "id": "6f9230af-2a98-4952-b205-9ede4f9ef548",
                "innerHtml": "<p><b>Hello!</b></p>"
              }
            ]
          }
        ]
      }
    ]
  }
},
page_body = json.dumps(page_body, indent=4)
try:
    data = requests.post(endpoint, headers=http_headers, stream=False, data=page_body).json()
except:
    data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, data=page_body).json()
    # data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, json = page_body).json()

page_id = data['id']  # Page ID from the response of the creation
print(f"Page created with ID: {page_id}")

update_payload = {
    'promotionKind': 'newsPost',
}
update_payload= json.dumps(update_payload, indent=4)

try:
    data = requests.patch(f'https://graph.microsoft.com/v1.0/sites/{site_id}/pages/{page_id}/microsoft.graph.sitePage', headers=http_headers, stream=False, data = update_payload).json()
except:
    data = requests.patch(f'https://graph.microsoft.com/v1.0/sites/{site_id}/pages/{page_id}/microsoft.graph.sitePage', headers=http_headers, stream=False, proxies=proxies, data = update_payload).json()

Category_list = {'1':'Life', '2': 'Ford'}
print('-----------------------------------------\n')
print(Category_list)
print('-----------------------------------------\n')

print("----------Please go to website to update with category---------\n")

