import funcLG, requests
from bs4 import BeautifulSoup

login_return = funcLG.func_login_secret() # to login into MS365 and get the return value
result = login_return['result'] # to get the return value
proxies = login_return['proxies']

web_page_url = input('Please enter your web page url : \n')

try:
    data = requests.get(web_page_url)
except:
    data = requests.get(web_page_url, proxies=proxies)

# Check if the request was successful
if data.status_code == 200:
    # Parse the HTML content
    soup = BeautifulSoup(data.text, 'html.parser')


### Create a OneNote Page  ###
endpoint_create_page = 'https://graph.microsoft.com/v1.0/me/onenote/sections/{}/pages'.format(finance_section_id)
http_headers_create_page = {'Authorization': 'Bearer ' + result['access_token'],
               'Content-Type': 'application/xhtml+xml'}
page_title = 'Stock info {}'.format(day_one.strftime('%Y-%m-%d'))
create_page_initial = """
<!DOCTYPE html>
<html>
<head>
<title>{}</title>
<meta name="created" content="{}" />
</head>
<body>
<!-- No content in the body -->
</body>
</html>
""".format(page_title,(datetime.datetime.now(datetime.timezone.utc)+ datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S+08:00')).replace('\n','').strip()
try:
    data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial)
except:
    data = requests.post(endpoint_create_page, headers=http_headers_create_page, data=create_page_initial,proxies=proxies)
