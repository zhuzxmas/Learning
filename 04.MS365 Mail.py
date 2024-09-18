# -*- coding: utf-8 -*-
"""
Created on Sep 18, 2024  @author: Nathan. File Purpose: to use MS365 Graph API for mail service.
"""
import urllib.request
import pprint
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
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/mailFolders'.format(
        user_id)
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
            mailFolder_inbox_id = data['value'][i]['id']
        if data['value'][i]['displayName'] == 'Inbox':
            mailFolder_inbox_id = data['value'][i]['id']

    # to get the user latest 10 emails list with descent order with desc in the endpoint.
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/mailFolders/{}/messages?$orderby=receivedDateTime desc'.format(
        user_id, mailFolder_inbox_id)
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
    pprint.pprint(email_list)


    # to send an email to someone
    email_message= {
        'message': {
            'subject': 'Test email from Microsoft Graph API',
            'body': {
                'contentType': 'Text',
                'content': 'Hello, this is a test email sent using the Microsoft Graph API.'
            },
            'toRecipients': [
                {
                    'emailAddress': {
                        'address': 'zhuzx2006@outlook.com'
                    }
                }
            ]
        },
        'saveToSentItems': True
    },
    # email_message = json.dumps(email_message, indent=4)
    email_message = json.dumps(email_message)
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/sendMail'.format(
        user_id)
    try:
        data = requests.post(endpoint, headers=http_headers,
                             stream=False, data=email_message).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies, data=email_message).json()


main()
