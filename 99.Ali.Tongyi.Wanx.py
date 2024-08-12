import requests, json, time, configparser, os

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application
    config.read(['config.cfg'])
    aliyun_settings = config['Aliyun']
    proxy_settings = config['proxy_add']
    proxy_add = proxy_settings['proxy_add']
    qwen_key = aliyun_settings['aliyun_SECRET']
else: # to get this info from Github Secrets, for Github Action running application
    qwen_key = os.environ['QWEN_KEY']
    proxy_add = os.environ['PROXY_ADD']

#代理信息，如没有则可以忽略
proxies = {
  "http": proxy_add,
  "https": proxy_add
}
proxies=proxies

model_name = 'wanx-style-repaint-v1'

endpoint_up = 'https://dashscope.aliyuncs.com/api/v1/files'

http_headers_up = {
                'Authorization': 'Bearer {}'.format(qwen_key),
                }

file_name = input('Please enter a file name, with extension: \n')

upload_form= {
    'files':  (file_name, open(file_name, 'rb')),
}


# to excute the uploading process to Aliyun server:
try:
    data_up = requests.post(endpoint_up, headers=http_headers_up, stream=False, files=upload_form)
except:
    data_up = requests.post(endpoint_up, headers=http_headers_up, stream=False, proxies=proxies, files=upload_form)


http_headers = {
                'Authorization': 'Bearer {}'.format(qwen_key),
                'Content-Type': 'application/json'}

# to list all the files in Aliyun server:
try:
    data_list = requests.get(endpoint_up, headers=http_headers, stream=False)
except:
    data_list = requests.get(endpoint_up, headers=http_headers, stream=False, proxies=proxies)

pic_url_on_Aliyun = data_list.json()['data']['files'][0]['url']
pic_file_id = data_list.json()['data']['files'][0]['file_id']


# to excute the pic inquery with wanx-style-repaint-v1
endpoint_wanx = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation'
http_headers_wanx = {
                'Authorization': 'Bearer {}'.format(qwen_key),
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'enable'
                }

data_body= {
    'model': 'wanx-style-repaint-v1',
    'input': {
        'image_url': pic_url_on_Aliyun,
        'style_index': 1
    }
}

try:
    data_inquery_wx = requests.post(endpoint_wanx, headers=http_headers_wanx, stream=False, data=json.dumps(data_body))
except:
    data_inquery_wx = requests.post(endpoint_wanx, headers=http_headers_wanx, stream=False, proxies=proxies, data=json.dumps(data_body))

task_id = data_inquery_wx.json()['output']['task_id']

# wait 60s before the task is completed, you can adjust this  by yourself
time.sleep(60)

# to check the task status:
endpoint_task = 'https://dashscope.aliyuncs.com/api/v1/tasks/{}'.format(task_id)
http_headers = {
                'Authorization': 'Bearer {}'.format(qwen_key),
                'Content-Type': 'application/json'}
try:
    data_task = requests.get(endpoint_task, headers=http_headers, stream=False)
except:
    data_task = requests.get(endpoint_task, headers=http_headers, stream=False, proxies=proxies)

while data_task.json()['output']['task_status'] == 'RUNNING':
   print('the task is still running...\n')
   time.sleep(60)
   try:
       data_task = requests.get(endpoint_task, headers=http_headers, stream=False)
   except:
       data_task = requests.get(endpoint_up, headers=http_headers, stream=False, proxies=proxies)

if data_task.json()['output']['task_status'] == 'SUCCEEDED':
    output_url = data_task.json()['output']['results'][0]['url']
    print('The new picture is ready, please download from this URL: {}\n'.format(output_url))
elif data_task.json()['output']['task_status'] == 'FAILED':
    print('The task is failed, the reason is: \n'.format(data_task.json()['output']['message']))

# to delete the file uploaded:
endpoint_file_uploaded = 'https://dashscope.aliyuncs.com/api/v1/files/{}'.format(pic_file_id)
http_headers_delete = {
                'Authorization': 'Bearer {}'.format(qwen_key),
                'Accept': 'application/json'}

try:
    data_delete = requests.delete(endpoint_file_uploaded, headers=http_headers_delete, stream=False)
except:
    data_delete = requests.delete(endpoint_file_uploaded, headers=http_headers_delete, stream=False, proxies=proxies)

if data_delete.status_code == 200:
    print('Uploaded File Deleted Successfully !!! ')