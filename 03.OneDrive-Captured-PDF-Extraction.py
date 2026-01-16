import funcLG
import requests
from pdf2image import convert_from_path
import os


def pdf_to_images(pdf_path, output_folder="output_images", dpi=400):
    # Create output folder
    os.makedirs(output_folder, exist_ok=True)

    # Convert PDF pages to images
    pages = convert_from_path(
        pdf_path,
        dpi=dpi,
        fmt="png",
        thread_count=4,
        poppler_path=None  # Add if Poppler not in PATH (Windows)
    )

    # Save each page
    for i, page in enumerate(pages):
        if i < 10:
            number = '0{}'.format(i)
        else:
            number = '{}'.format(i)
        image_path = os.path.join(output_folder, "page_{}.png".format(number))
        page.save(image_path, "PNG")
        print(f"Saved: {image_path}")


login_return_secret = funcLG.func_login_secret() # to login into MS365 and get the return value info.
result_secret = login_return_secret['result']
access_token_secret = result_secret['access_token']
proxies = login_return_secret['proxies']

File_ID = os.environ['file_id']
File_Name_With_Extension = os.environ['file_name_with_extension']
Parent_ID = os.environ['parent_id']

### to get the user_id first... ####
# the endpoint shall not use /me, use [users] instead...
endpoint = 'https://graph.microsoft.com/v1.0/users/'
http_headers = {'Authorization': 'Bearer ' + access_token_secret,
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

# https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0&tabs=http
# check the link for the manual
endpoint = 'https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/content'.format(user_id, File_ID)
http_headers = {'Authorization': 'Bearer ' + access_token_secret}
try:
    data = requests.get(endpoint, headers=http_headers, stream=False)
except:
    data = requests.get(endpoint, headers=http_headers, stream=False, proxies=proxies)

# save file as downloaded_file.pdf
if data.status_code == 200:
    pdf_content = data.content
    print("PDF downloaded successfully!")
else:
    raise Exception(f"Failed to download: {data.status_code}, {data.text}")

# 4. Save PDF to Local File
local_pdf_path = "downloaded_file.pdf"
with open(local_pdf_path, "wb") as f:
    f.write(pdf_content)


# Usage
pdf_to_images("downloaded_file.pdf")

for filename in os.listdir('output_images'):
    if not filename.lower().endswith(('.png', '.jpg', '.jpeg')):
        continue

    upload_url = 'https://graph.microsoft.com/v1.0/users/{}/drive/items/{}:/{}:/content'.format(user_id, Parent_ID, filename)
    headers = {"Authorization": f"Bearer {access_token_secret}"}
    
    image_path = os.path.join('output_images', filename)
    with open(image_path, 'rb') as f:
        image_data = f.read()

    try:
        response = requests.put(upload_url, headers=headers, data=image_data)
    except:
        response = requests.put(upload_url, headers=headers, data=image_data, proxies=proxies)

    if response.status_code == 201:
        print(f"✅ Uploaded: {filename}")
    else:
        print(f"❌ Failed to upload {filename}: {response.status_code} - {response.text}")