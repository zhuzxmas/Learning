import requests, json, configparser, os
import pprint
import time as tm
import urllib.parse
from datetime import datetime, date, time

config = configparser.ConfigParser()
if os.path.exists('./config.cfg'): # to check if local file config.cfg is available, for local running application....
    config.read(['config.cfg'])
    aliyun_settings = config['Aliyun']
    proxy_settings = config['proxy_add']
    proxy_add = proxy_settings['proxy_add']
    qwen_key = aliyun_settings['aliyun_SECRET']
else: # to get this info from Github Secrets, for Github Action running application
    qwen_key = os.environ['QWEN_KEY']
    proxy_add = os.environ['PROXY_ADD']

#代理信息，如没有, 则可以忽略
proxies = {
  "http": proxy_add,
  "https": proxy_add
}
proxies=proxies

cookies_var = input('\nPlease input the cookies\n')
date_yy = input('\nPlease input 月份 yy : default = 11 \n') or '11'
date_dd = input('\nPlease input 日期 dd : default = 03 \n') or '03'
start_hour = int(input('\nPlease input 小时 hh : default = 18 \n') or '18')
start_minute = int(input('\nPlease input 分钟 mm : default = 0 \n') or '0')

# Form data as a clean Python dictionary (URL-decoded)
form_data_zzx = {
    "memberId": "094D58F7ADB511F0BA0A005056B6E016",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "12383",
    "doctorName": "糖尿病眼底病变专科(区)",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "10:00",
    "endTime": "10:30",
    "fee": "0.00",
    "treatFee": "13.00",
    "patientId": "8238342",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L83056330",
    "canStudySample": "0",
    "regType": "1"
}

form_data_gao_am1 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "08:00",
    "endTime": "08:30",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}

form_data_gao_am2 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "08:30",
    "endTime": "09:00",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}
form_data_gao_am3 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "09:00",
    "endTime": "09:30",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}
form_data_gao_am4 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "09:30",
    "endTime": "10:00",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}
form_data_gao_am5 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "10:00",
    "endTime": "10:30",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}
form_data_gao_am6 = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "上午",
    "beginTime": "10:30",
    "endTime": "11:00",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}
form_data_gao_pm = {
    "memberId": "9CE65C868C5511EF8C9AFA163E2CAC6A",
    "deptCode": "827",
    "deptName": "眼底病门诊(区庄)",
    "doctorCode": "3632",
    "doctorName": "杨晖",
    "date": "2025-{}-{}".format(date_yy, date_dd),
    "time": "0",
    "timeName": "下午",
    "beginTime": "15:00",
    "endTime": "15:30",
    "fee": "0.00",
    "treatFee": "35.00",
    "patientId": "7658685",
    "patientYLZ": "",
    "firstPatientTypeId": "0",
    "firstPatientTypeName": "",
    "oldPatientTypeId": "1480",
    "oldPatientTypeName": "自费",
    "title": "",
    "registerType": "专科",
    "regFlag": "false",
    "userJKK": "L82533366",
    "canStudySample": "1",
    "regType": "1"
}



# Encode the form data back to URL-encoded string (as required by Content-Type)
encoded_data_am_zzx= urllib.parse.urlencode(form_data_zzx, encoding='utf-8')
encoded_data_am1= urllib.parse.urlencode(form_data_gao_am1, encoding='utf-8')
encoded_data_am2= urllib.parse.urlencode(form_data_gao_am2, encoding='utf-8')
encoded_data_am3= urllib.parse.urlencode(form_data_gao_am3, encoding='utf-8')
encoded_data_am4= urllib.parse.urlencode(form_data_gao_am4, encoding='utf-8')
encoded_data_am5= urllib.parse.urlencode(form_data_gao_am5, encoding='utf-8')
encoded_data_am6= urllib.parse.urlencode(form_data_gao_am6, encoding='utf-8')
encoded_data_pm = urllib.parse.urlencode(form_data_gao_pm, encoding='utf-8')

# Request headers
headers = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://zocwbyypt.gzzoc.com",
    "Referer": "https://zocwbyypt.gzzoc.com/MedicalMobile/dist/?",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.63(0x18003f2f) NetType/WIFI Language/en",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Connection": "keep-alive",
}

# Cookies
cookies = {
    "JSESSIONID": cookies_var
}

# Send POST request
url = "https://zocwbyypt.gzzoc.com/MedicalMobile/client/register/order/save"


# --- 1. Define your target time (must be in the future) ---
# --- Use today's date at 18:00:00 ---
today = date.today()
target_time = datetime.combine(today, time(hour=start_hour, minute=start_minute, second=0, microsecond=0))

# Alternative one-liner:
# target_time = datetime.now().replace(hour=18, minute=0, second=0, microsecond=0)

print(f"Scheduled to send at: {target_time}")

# --- 2. Wait until that time ---
now = datetime.now()
while now < target_time:
    tm.sleep(0.001)  # Sleep 1ms to reduce CPU usage
    now = datetime.now()

# --- 3. Send the request IMMEDIATELY after reaching target time ---
print("Sending request at:", datetime.now())

response = requests.post(url, headers=headers, cookies=cookies, data=encoded_data_am1, verify=False)
pprint.pprint(response.json())

# Output result
# print("Status Code:", response.status_code)
if response.status_code == 200:
    if response.json()['code'] != '0':
        # send a new request for the afternoon:
        response = requests.post(url, headers=headers, cookies=cookies, data=encoded_data_am1, verify=False)
        pprint.pprint(response.json())
        if response.status_code == 200:
            if response.json()['code'] != '0':
                # send a new request for the afternoon:
                response = requests.post(url, headers=headers, cookies=cookies, data=encoded_data_am1, verify=False)
                pprint.pprint(response.json())

if response.json()['code'] == '0':
    print('Order Number: {}\n'.format(response.json()['order']['orderNo']))
    print('Order patientName: {}\n'.format(response.json()['order']['patientName']))
    print('Order patientId: {}\n'.format(response.json()['order']['patientId']))
