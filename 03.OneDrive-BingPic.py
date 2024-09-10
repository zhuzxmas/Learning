# -*- coding: utf-8 -*-
"""
Created on Jul 18, 2018  @author: CloudSkyRiver. File function: download today's Bing China wallpaper, and set as windows desktop background.
"""
import urllib.request
import requests
import os.path
import json
from PIL import Image, ImageFont, ImageDraw
import funcLG

notifymsg = 'today\'s Bing wallpaper'


def save_img(img_url):  # save downloaded file to directory: dirname
    # get the image name,  including suffix
    basename = os.path.basename(img_url)
    basename = basename[10:]
    basename = basename[:basename.index('&')]
#    filepath = os.path.join(dirname, basename)  #join directory name and image name together
    filepath = basename  # join directory name and image name together
    # download image,  and save to directory: dirname
    urllib.request.urlretrieve(img_url, filepath)
    add_img_description(notifymsg, filepath)
    print("Save", filepath, "successfully!")
    return [filepath, basename]

# another wallpaper source: https://momentumdash.com/app/backgrounds.json
# def get_img_url(raw_img_url = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=1&n=1"):  # get the real img url by using the raw_img_url address


# get the real img url by using the raw_img_url address
def get_img_url(raw_img_url="http://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&pid=hp&FORM=BEHPTB&uhd=1&uhdwidth=3840&uhdheight=2160&mkt=zh_CN"):
    global notifymsg
    r = requests.get(raw_img_url)
    rtext = json.loads(r.text)
    # get the correct url for image
    img_url = 'https://cn.bing.com' + rtext['images'][0]['url']
    notifymsg = rtext['images'][0]['copyright']
    print('img_url:', img_url)
    # get the image name,  including suffix
    pic_name = os.path.basename(img_url)
    return [img_url, pic_name]


def add_img_description(notifymsg, filepath):
    # font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc",20)
    font_english = ImageFont.truetype("Ubuntu-R.ttf", 44)
    font_chinese = ImageFont.truetype("msyh.ttc", 44)

    imagetemp = Image.open(filepath)
    draw = ImageDraw.Draw(imagetemp)
    x, y = 10, 1950

    # Function to determine the font based on the character
    def get_font(char):
        # Simplified check: if the character is in the ASCII range, it's probably English
        return font_english if ord(char) < 128 else font_chinese

    # Splitting the text into segments and drawing them
    for char in notifymsg:
        font = get_font(char)

        # Draw text border:
        draw.text((x-1, y), char, fill=(112, 39, 77), font=font)
        draw.text((x+1, y), char, fill=(112, 39, 77), font=font)
        draw.text((x, y-1), char, fill=(112, 39, 77), font=font)
        draw.text((x, y+1), char, fill=(112, 39, 77), font=font)

        # Draw text
        draw.text((x, y), char, fill=(250, 250, 250), font=font)

        # Move the x position for the next character
        x += font.getsize(char)[0]

    imagetemp.save(filepath)


def main():
    img_url = get_img_url()
    save_img_result = save_img(img_url[0])  # this is image saved filepath

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
    endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drives/{}/root:/Pictures/Bing.WallPaper:/'.format(
        user_id, user_drive_id)
    try:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False).json()
    except:
        data = requests.get(endpoint, headers=http_headers,
                            stream=False, proxies=proxies).json()
    bing_wallpaper_id = data['id']

    # Define the endpoint to upload the file
    upload_endpoint = f"https://graph.microsoft.com/v1.0/users/{user_id}/drives/{user_drive_id}/items/{bing_wallpaper_id}:/{save_img_result[1]}:/content"

    # Read the image file content
    with open(save_img_result[1], 'rb') as file:
        image_content = file.read()

    try:
        # Make the request with proxies if defined
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=image_content)
        # Raises an HTTPError if the HTTP request returned an unsuccessful status code
        upload_response.raise_for_status()

        print(f"Image uploaded successfully to Bing.WallPaper folder.")
    except:
        upload_response = requests.put(
            upload_endpoint, headers=http_headers, data=image_content, proxies=proxies)
        print(f"Image uploaded successfully to Bing.WallPaper folder.")

    os.remove(save_img_result[1])


main()
