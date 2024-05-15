import requests

proxy_add = 'http://internet.ford.com:83/'
proxies = {
  "http": proxy_add,
  "https": proxy_add
}
proxies=proxies

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

### 1st request to get the cookies ###
endpoint = 'https://cnmas.sharepoint.com/:x:/s/cmmas/EYk9dwt_JdJFpk_zgxbky30BEg88XZ2vHnGIJqtBg3df5A?e=dcPVhf' #this is the link from OneDrive Shared file, you can do it by: share the file --> copy link, because this link contain the anonymous login token.
response = requests.get(endpoint, proxies=proxies)

### 2nd request to get the real content, but it is needed to mimic the behavior real browser ###
endpoint = 'https://cnmas.sharepoint.com/sites/cmmas/Shared%20Documents/99.Public/NJ-MAS-Commute-Data.txt' # this is the real link for the real content
response = requests.get(endpoint, cookies=response.cookies,headers=headers, proxies=proxies)
