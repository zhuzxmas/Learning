# -*- coding: utf-8 -*-
"""
Created on Sep 18, 2024  @author: Nathan. File Purpose: to use MS365 Graph API for mail service.
"""
import urllib.request
import requests
import os.path
import json
import funcLG

def main():

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

    # to list mail folders:
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/mailFolders'
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
        if data['value'][i]['displayName'] == 'Inbox':
            mailFolder_id = data['value'][i]['id']



    # to get the user latest 10 emails list.
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/mailFolders/{}/messages?$orderby=receivedDateTime desc'.format(
        user_id, mailFolder_id)
    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    email_list = []
    for i in range(0, len(data['value'])):
        email_temp = []
        email_temp.append(data['value'][i]['subject'])
        email_temp.append(data['value'][i]['from']['emailAddress']['name'])
        email_list.append(email_temp)
    print(email_list)




main()
