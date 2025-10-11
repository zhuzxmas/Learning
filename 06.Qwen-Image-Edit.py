import json
import requests
import funcLG
import urllib
import os
from dashscope import MultiModalConversation
import dashscope

def save_img(img_url):  # save downloaded file to directory: dirname
    # get the image name,  including suffix
    basename = os.path.basename(img_url).split('?')[0]
    # download image,  and save to directory: dirname
    urllib.request.urlretrieve(img_url, basename)
    print("Save", basename, "successfully!")
    return basename

# 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
api_key = os.environ['ali_cloud_secret']
image_edit_input_url = os.environ['image_edit_input_url']
image_edit_input_text = os.environ['image_edit_input_text']

dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

messages = [
    {
        "role": "user",
        "content": [
            {"image": image_edit_input_url},
            {"text": image_edit_input_text}
        ]
    }
]

response = MultiModalConversation.call(
    api_key=api_key,
    model="qwen-image-edit",
    messages=messages,
    result_format='message',
    stream=False,
    watermark=False,
    negative_prompt=""
)


if response.status_code == 200:
    # 如需查看完整响应，请取消下行注释
    image_output_url = response.output.choices[0].message.content[0]['image']
    print("输出图像的URL:", image_output_url)
    print(json.dumps(response, ensure_ascii=False))

    save_img_result = save_img(image_output_url)

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

    # to get the user OneDrive 00.Converted folder #id.
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drives/{}/root:/Pictures/Camera Roll/00.Converted:/'.format(
        user_id, user_drive_id)
    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    folder_id = data['id']

    # Define the endpoint to upload the file
    upload_endpoint = f"https://graph.microsoft.com/v1.0/users/{user_id}/drives/{user_drive_id}/items/{folder_id}:/{save_img_result}:/content"

    # Read the image file content
    with open(save_img_result, 'rb') as file:
        image_content = file.read()

    try:
        # Make the request with proxies if defined
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=image_content)
        # Raises an HTTPError if the HTTP request returned an unsuccessful status code
        upload_response.raise_for_status()

        print(f"Image uploaded successfully to 00.Converted folder.")
    except:
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=image_content, proxies=proxies)
        print(f"Image uploaded successfully to 00.Converted folder.")

    os.remove(save_img_result)
else:
    print(f"HTTP返回码：{response.status_code}")
    print(f"错误码：{response.code}")
    print(f"错误信息：{response.message}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")

