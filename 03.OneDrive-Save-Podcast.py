# -*- coding: utf-8 -*-
"""
Created on Jul 18, 2018  @author: CloudSkyRiver. File function: download today's Bing China wallpaper, and set as windows desktop background.
"""
import urllib.request
import requests
import os.path
import json
import funcLG


def save_file(file_url):  # save downloaded file to directory: dirname
    # get the image name,  including suffix
    basename = os.path.basename(file_url)
    # basename = basename[10:]
    # basename = basename[:basename.index('&')]
    # filepath = os.path.join(dirname, basename)  #join directory name and image name together
    filepath = basename  # join directory name and image name together
    # download image,  and save to directory: dirname
    req = urllib.request.Request(
        file_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    )
    # Use urlopen with the request, then save manually
    with urllib.request.urlopen(req) as response:
        with open(filepath, 'wb') as f:
            f.write(response.read())

    # urllib.request.urlretrieve(file_url, filepath)
    print("Save", filepath, "successfully!")
    return [filepath, basename]

# another wallpaper source: https://momentumdash.com/app/backgrounds.json
# def get_file_url(raw_file_url = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=1&n=1"):  # get the real img url by using the raw_file_url address


def main():
    # file_url = input('Please input the URL ... :\n')
    file_url = os.environ['file_url']
    file_title = os.environ['file_title']
    save_file_result = save_file(file_url)  # this is image saved filepath

    # to login into MS365 and get the return value
    login_return = funcLG.func_login_secret()
    result = login_return['result']
    proxies = login_return['proxies']

    # the endpoint shall not use /me, shall be updated here.
    endpoint = 'https://graph.microsoft.com/v1.0/users/'
    http_headers = {'Authorization': 'Bearer ' + result['access_token'],
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'}

    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    for i in range(0, len(data['value'])):
        if data['value'][i]['givenName'] == 'Nathan':
            user_id = data['value'][i]['id']

    # to get the user OneDrive #id.
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drives/'.format(
        user_id)
    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    for i in range(0, len(data['value'])):
        if data['value'][i]['name'] == 'OneDrive':
            user_drive_id = data['value'][i]['id']

    # to get the user OneDrive Pictures folder #id.
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drives/{}/root:/OneNote Uploads:/'.format(
        user_id, user_drive_id)
    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    onenote_update_folder = data['id']

    # Define the endpoint to upload the file
    upload_endpoint = f"https://graph.microsoft.com/v1.0/users/{user_id}/drives/{user_drive_id}/items/{onenote_update_folder}:/{save_file_result[1]}:/content"

    # Read the image file content
    with open(save_file_result[1], 'rb') as file:
        file_content = file.read()

    try:
        # Make the request with proxies if defined
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=file_content)
        # Raises an HTTPError if the HTTP request returned an unsuccessful status code
        upload_response.raise_for_status()

        print(f"File uploaded successfully to OneNote Uploads folder.")
    except:
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=file_content, proxies=proxies)
        print(f"File uploaded successfully to OneNote Uploads folder.")

    os.remove(save_file_result[1])


main()
