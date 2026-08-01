# -*- coding: utf-8 -*-
"""
Created on Jul 18, 2018  @author: CloudSkyRiver. File function: download today's Bing China wallpaper.

Personal-OneDrive edition: instead of uploading to OneDrive for Business (via the
app-only client-credentials flow used by 03.OneDrive-BingPic.py), this variant
uploads the wallpaper to the user's *personal* OneDrive using the delegated
refresh-token client (onedrive_personal.OneDrivePersonal), saving to
    Pictures/life.live/Bing.WallPaper/<image>
The original 03.OneDrive-BingPic.py is left untouched.
"""
import urllib.request
from datetime import date
import requests
import os.path
import json
from PIL import Image, ImageFont, ImageDraw
from onedrive_personal import OneDrivePersonal, load_config_cfg_env

notifymsg = 'today\'s Bing wallpaper'

def get_weeks_remaining():
    today = date.today()
    target = date(2029, 4, 30)
    return (target - today).days // 7

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

# another wallpaper source:: https://momentumdash.com/app/backgrounds.json
# def get_img_url(raw_img_url = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=1&n=1"):  # get the real img url by using the raw_img_url address


# get the real img url by using the raw_img_url address, for Bing CN WallPaper, use mkt=zh-CN.
def get_img_url(raw_img_url="http://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&pid=hp&FORM=BEHPTB&uhd=1&uhdwidth=3840&uhdheight=2160&mkt=zh-CN"):
    global notifymsg
    r = requests.get(raw_img_url)
    rtext = json.loads(r.text)
    # get the correct url for image
    img_url = 'https://cn.bing.com' + rtext['images'][0]['url']
    notifymsg = rtext['images'][0]['copyright']
    print('img_url:', img_url)
    # get the image name,  including suffix.
    pic_name = os.path.basename(img_url)
    return [img_url, pic_name]


def add_img_description(notifymsg, filepath):
    # font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc",20)
    font_english = ImageFont.truetype("Ubuntu-R.ttf", 44)
    font_chinese = ImageFont.truetype("msyh.ttc", 44)

    imagetemp = Image.open(filepath)
    draw = ImageDraw.Draw(imagetemp)
    x, y = 10, 1970

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
        # x += font.getsize(char)[0]   # for pillow version == 9.0.1
        x += font.getlength(char)  # For Pillow version >= 9.0.1
        # x += font.getbbox(char)[0]   # for pillow version >= 10.4.1, but further updates are needed, this sentence is not correct.

    # Draw week countdown number — same font/height as description, right-aligned 50px from right edge
    week_text = str(get_weeks_remaining())
    bbox = font_english.getbbox(week_text)
    text_w = bbox[2] - bbox[0]
    img_w, img_h = imagetemp.size
    wx = img_w - text_w - 50
    wy = 1970  # same y as description text
    # Draw text border
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        draw.text((wx + dx, wy + dy), week_text, fill=(112, 39, 77), font=font_english)
    # Draw text
    draw.text((wx, wy), week_text, fill=(250, 250, 250), font=font_english)

    imagetemp.save(filepath)


def main():
    img_url = get_img_url()
    save_img_result = save_img(img_url[0])  # this is image saved filepath

    # ---- Upload to PERSONAL OneDrive (delegated refresh-token client) --------
    # Locally, config.cfg hydrates the ONEDRIVE_* env vars and forces
    # rt-readonly so the shared token is never rotated during testing. In GitHub
    # Actions there is no config.cfg, so rotation is enabled (and the workflow
    # commits the rotated rt.enc back, guarded by the onedrive-token concurrency
    # group shared with the finance/summarizer workflows).
    proxy_add = load_config_cfg_env()
    proxies = {"http": proxy_add, "https": proxy_add} if proxy_add else None

    od = OneDrivePersonal(proxies=proxies)

    with open(save_img_result[1], 'rb') as file:
        image_content = file.read()

    target = "Pictures/life.live/Bing.WallPaper/" + save_img_result[1]
    od.upload_to_path(target, image_content, content_type="image/jpeg")
    print("Image uploaded successfully to personal OneDrive: " + target)

    os.remove(save_img_result[1])


main()
