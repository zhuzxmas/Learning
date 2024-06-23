import json, requests, datetime, os
from pandas import DataFrame
import funcLG

login_return = funcLG.func_login() # to login into MS365 and get the return value info
result = login_return['result']
proxies = login_return['proxies']

endpoint = 'https://graph.microsoft.com/v1.0/sites?search={cnmas}'
http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                'Accept': 'application/json',
                'Content-Type': 'application/json'}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False).json()
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies).json()
output = data['value']

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
        "sections": [
            {
                "columns": [
                    {
                        "factor": 12,
                        "webparts": [
                            {
                                "innerHtml": 'hello'
                            }
                        ]
                    }
                ]
            }
        ]
    }
  }
page_body = json.dumps(page_body, indent=4)
try:
    data = requests.post(endpoint, headers=http_headers, stream=False, data = page_body).json()
except:
    data = requests.post(endpoint, headers=http_headers, stream=False, proxies=proxies, data = page_body).json()
