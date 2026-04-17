import json, requests, datetime, os
from pandas import DataFrame
from datetime import datetime, timezone, timedelta
import funcLG
from PIL import Image
from io import BytesIO
from pillow_heif import register_heif_opener  # ← Import the opener
from urllib.parse import quote
import html
from bs4 import BeautifulSoup




login_return_secret = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result_secret = login_return_secret['result']
access_token_secret = result_secret['access_token']
site_id_cmmas = login_return_secret['site__id_cmmas']
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

# set the http headers for the Graph API requests:
http_headers = {'Authorization': 'Bearer ' + access_token_with_refresh_token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'}

http_headers_application = {'Authorization': 'Bearer ' + access_token_secret,
                'Accept': 'application/json',
                'Content-Type': 'application/json'}

last_7days_date = (datetime.now(timezone.utc) - timedelta(days=7))
last_7days_date = last_7days_date.strftime('%Y-%m-%dT%H:%M:%SZ')  # Convert to ISO format string for API query
last_30days_date = (datetime.now(timezone.utc) - timedelta(days=30))
last_30days_date = last_30days_date.strftime('%Y-%m-%dT%H:%M:%SZ')  # Convert to ISO format string for API query
today_date = datetime.now(timezone.utc)
today_date = today_date.strftime('%Y-%m-%dT%H:%M:%SZ')  # Convert to ISO format string for API query


# to get the latest 7days of SharePoint List items, make sure to specify the site id and list id:
site_id = site_id_cmmas
list_name = 'Family Spending'
# to get the list id, you can use this API to list all the lists in the site:
endpoint_sharepoint_lists = 'https://graph.microsoft.com/v1.0/sites/{}/lists'.format(site_id)
try:    sharepoint_lists_data = requests.get(endpoint_sharepoint_lists, headers=http_headers, stream=False)
except:    sharepoint_lists_data = requests.get(endpoint_sharepoint_lists, headers=http_headers, stream=False, proxies=proxies)
if sharepoint_lists_data.status_code == 200:
    sharepoint_lists_data_json = sharepoint_lists_data.json()
    lists = sharepoint_lists_data_json['value']
    list_id = None
    for lst in lists:
        if lst['displayName'] == list_name:
            list_id = lst['id']
            break
    if list_id is None:
        print("List '{}' not found in the site.".format(list_name))
else:    
    print("Failed to get SharePoint lists data. Status code:", sharepoint_lists_data.status_code)
    list_id = None

endpoint_sharepoint_list = 'https://graph.microsoft.com/v1.0/sites/{}/lists/{}/items?' \
    '$expand=fields&' \
    '$top=1000&' \
    '$filter=fields/Modified ge \'{}\' &' \
    '$orderby=fields/Modified desc'.format(site_id, list_id, last_7days_date)
try:
    sharepoint_list_data = requests.get(endpoint_sharepoint_list, headers=http_headers, stream=False)
except:
    sharepoint_list_data = requests.get(endpoint_sharepoint_list, headers=http_headers, stream=False, proxies=proxies)
if sharepoint_list_data.status_code == 200:
    sharepoint_list_data_json = sharepoint_list_data.json()
    list_items = sharepoint_list_data_json['value']
else:    
    print("Failed to get SharePoint list items data. Status code:", sharepoint_list_data.status_code)
    list_items = []




# to get the latest 7days of files from OneDrive for Business:
#TODO


# to get the latest 7days of mail from Outlook inbox and sent items:
endpoint_mail = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?' \
    '$filter=receivedDateTime ge {}&' \
    '$select=subject,receivedDateTime,webLink'.format(last_7days_date)
try:
    mail_data_inbox = requests.get(endpoint_mail, headers=http_headers, stream=False)
except:
    mail_data_inbox = requests.get(endpoint_mail, headers=http_headers, stream=False, proxies=proxies)

endpoint_mail = 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?' \
    '$filter=receivedDateTime ge {}&' \
    '$select=subject,receivedDateTime,webLink'.format(last_7days_date)
try:
    mail_data_sent = requests.get(endpoint_mail, headers=http_headers, stream=False)
except:
    mail_data_sent = requests.get(endpoint_mail, headers=http_headers, stream=False, proxies=proxies)

mail_id_list = []
for mail_data in [mail_data_inbox, mail_data_sent]:
    if mail_data.status_code == 200:
        mail_data_json = mail_data.json()
        mails = mail_data_json['value']
        for mail in mails:
            mail_id_list.append(mail['id'])
    else:
        print("Failed to get mail data. Status code:", mail_data.status_code)

# to get the mail content, you can use this API with the mail id:
mail_content_list = []
for mail_id in mail_id_list:
    endpoint_mail_content = 'https://graph.microsoft.com/v1.0/me/messages/{}?' \
    '$select=subject,receivedDateTime,webLink,body'.format(mail_id)
    try:
        mail_content_data = requests.get(endpoint_mail_content, headers=http_headers, stream=False)
    except:
        mail_content_data = requests.get(endpoint_mail_content, headers=http_headers, stream=False, proxies=proxies)
    if mail_content_data.status_code == 200:
        mail_content_data_json = mail_content_data.json()
        # mail_content_data_html = mail_content_data_json['body']['content']
        # mail_content_data_html = html.unescape(mail_content_data_html)  # Unescape HTML entities
        # mail_content_data_text = BeautifulSoup(mail_content_data_html, 'html.parser').get_text(separator='\n', strip=True)  # Convert HTML to plain text
        # mail_content_data_clean_text = mail_content_data_text.replace("\xa0", " ")  # Replace non-breaking spaces with regular spaces
        mail_content_data_text = BeautifulSoup(mail_content_data_json['body']['content'], 'html.parser')
        mail_content_data_clean_text = mail_content_data_text.get_text(separator=' ', strip=True)

        # mail_content_subject = mail_content_data_json['subject']
        mail_content_receivedDateTime = mail_content_data_json['receivedDateTime']
        # mail_content_list.append(dict(subject=mail_content_subject, content=mail_content_data_clean_text, receivedDateTime=mail_content_receivedDateTime))
        mail_content_list.append(dict(content=mail_content_data_clean_text, receivedDateTime=mail_content_receivedDateTime))
    else:
        print("Failed to get mail content data. Status code:", mail_content_data.status_code)

print(mail_content_list)


# to get the latest 7days of Teams chat messages:
teams_chat_content_list = []
# first, you need to get the chat id for the Teams chat you want to get messages from, you can use this API to list all the chats:
endpoint_teams_chats = 'https://graph.microsoft.com/v1.0/me/chats'
try:    
    teams_chats_data = requests.get(endpoint_teams_chats, headers=http_headers, stream=False)
except:    
    teams_chats_data = requests.get(endpoint_teams_chats, headers=http_headers, stream=False, proxies=proxies)
if teams_chats_data.status_code == 200:
    teams_chats_data_json = teams_chats_data.json()
    chats = teams_chats_data_json['value']
    for chat in chats:
        chat_id = chat['id']
        print("Chat id:", chat_id, "Chat topic:", chat.get('topic', 'N/A'))

        # to get the latest top 50 messages for the chat, you can use this API with the chat id:
        endpoint_teams_chat = (
            "https://graph.microsoft.com/v1.0/" \
            "chats/{}/messages/?$orderby=createdDateTime desc&$top=50".format(chat_id)
        )

        try:
            teams_chat_data = requests.get(endpoint_teams_chat, headers=http_headers, stream=False)
        except:
            teams_chat_data = requests.get(endpoint_teams_chat, headers=http_headers, stream=False, proxies=proxies)
        
        if teams_chat_data.status_code == 200:
            teams_chat_data_json = teams_chat_data.json()
            messages = teams_chat_data_json['value']
            for message in messages:
                message_createdDateTime = message['createdDateTime']
                if message_createdDateTime >= last_30days_date:
                    print("Message id:", message['id'], "Message content:", message['body']['content'], "Created date time:", message_createdDateTime)
                    soup_message = BeautifulSoup(message['body']['content'], 'html.parser')
                    # Extract ALL text from the entire document
                    message_text = soup_message.get_text(separator=' ', strip=True)
                    teams_chat_content_list.append(dict(content=message_text, receivedDateTime=message_createdDateTime))

            # use nextlink to get more messages if there are more than 50 messages in the chat:
            while '@odata.nextLink' in teams_chat_data_json and message_createdDateTime >= last_30days_date:
                next_link = teams_chat_data_json['@odata.nextLink']
                try:
                    teams_chat_data = requests.get(next_link, headers=http_headers, stream=False)
                except:
                    teams_chat_data = requests.get(next_link, headers=http_headers, stream=False, proxies=proxies)
                if teams_chat_data.status_code == 200:
                    teams_chat_data_json = teams_chat_data.json()
                    messages = teams_chat_data_json['value']
                    for message in messages:
                        message_createdDateTime = message['createdDateTime']
                        if message_createdDateTime >= last_30days_date:
                            print("Message id:", message['id'], "Message content:", message['body']['content'], "Created date time:", message_createdDateTime)
                            soup_message = BeautifulSoup(message['body']['content'], 'html.parser')
                            message_text = soup_message.get_text(separator=' ', strip=True)
                            teams_chat_content_list.append(dict(content=message_text, receivedDateTime=message_createdDateTime))
                        else:
                            break
                else:
                    print("Failed to get more Teams chat messages data. Status code:", teams_chat_data.status_code)
                    break
        else:
            print("Failed to get Teams chat messages data. Status code:", teams_chat_data.status_code)
else:    print("Failed to get Teams chats data. Status code:", teams_chats_data.status_code)
print(teams_chat_content_list)



# to get the latest 7days of Teams channel messages for certain channels only:
teams_channel_content_list = []
Channel_Life_Digest_Team_id = ''

Channel_Life_Digest_id = '19:19c38cf3573143429783cd275da79066@thread.tacv2' 
# Exclude Life_Digest channel data since it's used for posting the weekly digest summary, 
# and we don't want to include the historical digest messages in the new digest generation.

# to get the channel id, you can use this API to list all the teams and channels: 
endpoint_channels = 'https://graph.microsoft.com/v1.0/me/joinedTeams'
try:
    teams_data = requests.get(endpoint_channels, headers=http_headers, stream=False)
except:
    teams_data = requests.get(endpoint_channels, headers=http_headers, stream=False, proxies=proxies)

if teams_data.status_code == 200:
    teams_data_json = teams_data.json()
    teams_list = teams_data_json['value']
    for team in teams_list:
        team_id = team['id']

        # 1. Build the raw filter string (NO quotes around datetime)
        filter_raw = "lastModifiedDateTime gt {} and lastModifiedDateTime lt {}".format(last_30days_date, today_date)
        # 2. URL-encode the filter: spaces become '+' or '%20'
        filter_encoded = quote(filter_raw, safe=':/')  # safe='' encodes everything except unreserved chars
        # Or use: filter_encoded = filter_raw.replace(' ', '+')  # simpler alternative

        endpoint_channel_messages = 'https://graph.microsoft.com/v1.0/teams/{}/channels/getAllMessages?$filter={} &$top=15'.format(team_id, filter_encoded)
        try:
            channel_messages_data = requests.get(endpoint_channel_messages, headers=http_headers_application, stream=False)
        except:
            channel_messages_data = requests.get(endpoint_channel_messages, headers=http_headers_application, stream=False, proxies=proxies)
        if channel_messages_data.status_code == 200:
            channel_messages_data_json = channel_messages_data.json()
            messages_data_json = channel_messages_data_json['value']
            for message in messages_data_json:
                if message['channelIdentity']['channelId'] != Channel_Life_Digest_id: # Exclude Life_Digest channel id
                    channel_message_createdDateTime = message['createdDateTime']
                    if channel_message_createdDateTime >= last_30days_date:
                        print("Channel message id:", message['id'], "Channel message content:", message['body']['content'], "Created date time:", channel_message_createdDateTime)
                        soup_message = BeautifulSoup(message['body']['content'], 'html.parser')
                        # Extract ALL text from the entire document
                        message_text = soup_message.get_text(separator=' ', strip=True)
                        teams_channel_content_list.append(dict(content=message_text, receivedDateTime=channel_message_createdDateTime))
            
            # use nextlink to get more messages if there are more than 15 messages in the channel:
            while '@odata.nextLink' in channel_messages_data_json and channel_message_createdDateTime >= last_30days_date:
                next_link = channel_messages_data_json['@odata.nextLink']
                try:
                    channel_messages_data = requests.get(next_link, headers=http_headers_application, stream=False)
                except:
                    channel_messages_data = requests.get(next_link, headers=http_headers_application, stream=False, proxies=proxies)
                if channel_messages_data.status_code == 200:
                    channel_messages_data_json = channel_messages_data.json()
                    messages_data_json = channel_messages_data_json['value']
                    for message in messages_data_json:
                        channel_message_createdDateTime = message['createdDateTime']
                        if channel_message_createdDateTime >= last_30days_date:
                            print("Channel message id:", message['id'], "Channel message content:", message['body']['content'], "Created date time:", channel_message_createdDateTime)
                            soup_message = BeautifulSoup(message['body']['content'], 'html.parser')
                            # Extract ALL text from the entire document
                            message_text = soup_message.get_text(separator=' ', strip=True)
                            teams_channel_content_list.append(dict(content=message_text, receivedDateTime=channel_message_createdDateTime))
                        else:
                            break
                else:
                    print("Failed to get more Teams channel messages data. Status code:", channel_messages_data.status_code)
                    break
else:
    print("Failed to get Teams data. Status code:", teams_data.status_code)
print(teams_channel_content_list)

# to get the latest 7days of events from Outlook calendar, make sure to not select the events after today date:
endpoint_calendar = 'https://graph.microsoft.com/v1.0/me/calendar/events?$filter=start/dateTime ge {} and end/dateTime le {}&$select=subject,start,webLink'.format(last_7days_date, today_date)
try:
    calendar_data = requests.get(endpoint_calendar, headers=http_headers, stream=False)
except:
    calendar_data = requests.get(endpoint_calendar, headers=http_headers, stream=False, proxies=proxies)


# use the obtained mail content, teams chat content and teams channel content to generate a weekly digest summary with DashScope Qwen model:
raw_list = mail_content_list + teams_chat_content_list + teams_channel_content_list

valid_msgs = [
    m for m in raw_list 
    if m.get("content") and str(m["content"]).strip()
]
valid_msgs.sort(key=lambda x: x.get("receivedDateTime", ""))

# 3. Format into a clean, chronological log
formatted_chat = "\n".join(
    f"[{m['receivedDateTime']}] {m['content']}" for m in valid_msgs
)

# 5. Construct prompt
SYSTEM_PROMPT = """
你是一位资深内容分析师与信息架构师。请严格基于以下提供的文本，完成以下任务：

1. 识别核心主题：提取文本中涵盖的主要主题（建议 2～20 个，避免过细或过泛）。
2. 按主题归类：确保主题之间互斥且整体覆盖全面（MECE 原则）。
3. 撰写主题总结：每个主题生成一段 200～600 字的总结，包含：
   · 核心观点
   · 关键事实 / 数据
   · 结论或倾向
4. 严格按以下格式输出，不要添加任何额外解释或内容：

【主题一】：[主题名称]

· 包含要点：[用 3 个以内短句概括该主题下的主要内容]
· 总结：[总结内容]

【主题二】：[主题名称]

· 包含要点：...
· 总结：...

附加要求：

· 仅基于提供的文本，不补充外部知识，不虚构内容。
· 若某段内容明显涉及多个主题，归入最相关的一个，并在“包含要点”中标注“（交叉内容）”。
· 保持客观精炼，忽略无意义的语气词（如“哈哈”“嗯嗯”）。
· 如文本中存在无法归类的零散信息，单独列出【其他 / 待归类】。"""

USER_PROMPT = f"聊天记录：\n{formatted_chat}"

# url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

headers = {
    "Authorization": f"Bearer {funcLG.aliyun_secret}",
    "Content-Type": "application/json"
}

payload = {
    "model": "qwen3.6-plus-2026-04-02",
    "messages": [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_PROMPT},
    ],
    "enable_thinking": False
}

try:
     response = requests.post(url, headers=headers, json=payload)
except:
     response = requests.post(url, headers=headers, json=payload, proxies=proxies)

# Handle response
if response.status_code == 200:
    result = response.json()
    output_text = result['choices'][0]['message']['content']
    funcLG.send_Teams_Channel_Message(output_text, team_id=Channel_Life_Digest_Team_id, channel_id=Channel_Life_Digest_id, message_id=Channel_Msg_Life_Digest_id) # post the digest summary to the Life_Digest channel in CNMAS team.
    print(output_text)  # Print the assistant's reply
    print("✅ Success: Received response from Qwen model.")
    
else:
    print(f"❌ Error {response.status_code}: {response.text}")

