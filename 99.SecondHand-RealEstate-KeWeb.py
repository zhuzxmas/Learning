# -*- coding: utf-8 -*-
'''
Created on Oct 4, 2018

@author: ZZHU25
'''

import requests, bs4, os, time, random
from pypac import PACSession
from pypac.parser import PACFile
from pandas import DataFrame
import json
import pprint


soup1_house_title_list = []
soup1_house_title_link_list= []
soup1_house_detail_room_list= []
soup1_house_detail_room1_list= []
soup1_house_detail_room2_list= []
soup1_unit_price_list = []
soup1_total_price_list = []

city = input('请输入您想查看的城市, 比如：mas, nj, zj, etc...\n')
dict_cit_kw = {'nj': '320100'}
print("请输入想查看的小区：\n")
dict_com_kw = {'mas安粮城市广场':'c8741134013957049/',\
                'mas安粮秀山城市广场二期':'c8741134046466881',\
                'mas绿地新里西斯莱公馆':'c8741131400700049',\
                'mas绿地新里维多利亚公馆':'c8741131402795266',\
                'mas融邦领秀国际':'c8741131396511547',\
                'mas恒大御景湾':'c8741131386033515',\
                'mas绿地臻城一期':'c8741133987738181',\
                'mas西湖花园':'c8741131163630933',\
                'nj翠屏清华园':'c1411049353593',\
                'nj托乐嘉旺邻居':'c1411049363601',\
                'nj翠屏城':'c1411099647284',\
                'nj银城蓝溪郡':'c1411063103011',\
                'zj朗诗万都玲珑樾':'c8120034213244822',\
                'nj保利中央公园东苑':'c1411062783921',\
                'nj保利中央公园西苑':'c1420030179556725',\
                'nj保利梧桐语花园':'c1411099825154',\
                }

pprint.pprint(dict_com_kw)
input('Please press enter to continue: \n')

estate_area = input('Please input the community ==Name== you want to check, you can use any name, it will be used for the filename: \nJust copy and paste if it is existed above; You can also input whatever you want, BUT Chinese Characters are not recommended !!! : \n')
try:
    community_code = dict_com_kw[estate_area]
except:
    print('\n')
    print('Now, you need to input the Community Code by Yourself...\n')
    input('Please press enter to continue: \n')

    print('Since there is no suitable community above, please use your phone or computure to check the community code.')
    print('======================================')
    print('How to find the Community Code:\n')
    print('     ----- 1. Go to http://www.ke.com    \n')
    print('     ----- 2. Search the Community you want in ke.com website    \n')
    print('     ----- 3. Click the link for the Community you want from the Search Result    \n')
    print('     ----- 4. Observe the URI Address for this Community, it will be like    \n')
    print('     ------------------   https://nj.ke.com/ershoufang/c1411041475490/  ----------  \n')
    print('     ----- 5. Here, c1411041475490 is what you want, just copy it, you\'ll need to use it later.     \n')
    print('======================================')
    community_code = input('Please Input the Community Code: \n')


headerinfo = {
'Host': 'm.ke.com',
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/113.0',
'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
'Accept-Encoding': 'gzip, deflate,br',
'Referer': 'http://www.baidu.com',
'Connection': 'keep-alive',
'Cache-Control': 'max-age=0',
}


# this is for the final output data
data_out = []

page_number = 1
x = True


while x == True:
    url_temp = 'https://'+ 'm.ke.com/{}/ershoufang/'.format(dict_cit_kw[city])  + community_code + 'pg' + str(page_number)
    url_temp = 'https://m.ke.com/liverpool/api/ershoufang/getList?cityId={}&condition=%252F{}pg{}&curPage={}'.format(dict_cit_kw[city], community_code, str(page_number), str(page_number))
    print(url_temp + '\n')

    try:
        res = requests.get(url_temp,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
    except:
        with open(r'''C:\Users\zzhu25\OneDrive - azureford\important-docs\00.PythonScripts\pacfile''') as f:
            pac = PACFile(f.read())
        session = PACSession(pac)
        res = session.get(url_temp,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
    time.sleep(random.uniform(7, 13))
    res.raise_for_status()

    # soup1_total_number = bs4.BeautifulSoup(res.content,'lxml').select('div > div > h2 > span')
    # total_item = soup1_total_number[0].text.replace(" ","")
    soup1_page_info_details = res.json()['data']['data']['getErShouFangList']['list']
    has_more_page = res.json()['data']['data']['getErShouFangList']['hasMoreData']

    houses_number_this_page = len(soup1_page_info_details)
    for i in range(houses_number_this_page):
        data_out_temp = []
        if len(soup1_page_info_details[i]) != 1:
            house_title = soup1_page_info_details[i]['title']
            house_desc = soup1_page_info_details[i]['desc']
            house_unitPrice = soup1_page_info_details[i]['unitPriceInfo']['title']
            house_totalPrice = soup1_page_info_details[i]['totalPriceInfo']['title']
            if len(soup1_page_info_details[i]['colorTags']) != 0:
                house_history = soup1_page_info_details[i]['colorTags'][0]['title']
            else:
                house_history = ''

            house_url = '=HYPERLINK("' + soup1_page_info_details[i]['jumpUrl'] + '")'
            url = soup1_page_info_details[i]['jumpUrl']
        data_out_temp.append(house_title)
        data_out_temp.append(house_desc)
        data_out_temp.append(house_unitPrice)
        data_out_temp.append(house_totalPrice)
        data_out_temp.append(house_history)

        print('Page {}: {}/{}, Getting info from {} ---\n'.format(page_number, i, houses_number_this_page, url))
        try:
            res1 = requests.get(url,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
        except:
            with open(r'''C:\Users\zzhu25\OneDrive - azureford\important-docs\00.PythonScripts\pacfile''') as f:
                pac = PACFile(f.read())
            session = PACSession(pac)
            res1 = session.get(url,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
        time.sleep(random.uniform(7, 13))
        res1.raise_for_status()
        res1_info = bs4.BeautifulSoup(res1.content,'lxml').select('script[charset="utf-8"][type="text/javascript"]')[4]
        res1_info_json = json.loads(res1_info.text.replace(" window.__PRELOADED_STATE__ = ","").replace(';',''))
        try:
            list_time = res1_info_json['ershoufangDetail']['houseTrends']['time_line']['list_time']
        except:
            list_time = 'no info'

        try:
            details = str(res1_info_json['ershoufangDetail']['houseInfo']['more_info']['register_info']['list'])
        except:
            details = 'no info'
        data_out_temp.append(list_time)
        data_out_temp.append(details)


        data_out_temp.append(house_url)

        data_out.append(data_out_temp)

    if has_more_page == 1:
        x = True
        page_number = page_number + 1
    else:
        x = False

soup1_consolidate_DataFrame = DataFrame(data_out,columns=['house title','house desc','unit price','total price w RMB', 'History', 'Online starts', 'details','house link'])
print(soup1_consolidate_DataFrame)
soup1_consolidate_DataFrame.to_csv('ke-{}_{}.csv'.format(city,estate_area),mode='w',header=True, index=False, encoding='utf_8_sig')
enditem = input("")


# pages = int(int(total_item)/30)+1 #此处获取一共有几页
# print("一共需要下载 {} 页信息:".format(str(pages)) + '\n')
#
# for page in range (1,pages+1,1):
    # url = 'https://' + '{}.ke.com/ershoufang/'.format(city) + 'pg' + str(page) + dict_city_kw[estate_area]
    # print(url+ '\n' + "We'll get information from this page.")
#
    # try:
        # res = requests.get(url,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
    # except:
        # with open(r'''C:\Users\zzhu25\OneDrive - azureford\important-docs\00.PythonScripts\pacfile''') as f:
            # pac = PACFile(f.read())
        # session = PACSession(pac)
        # res = session.get(url,headers=headerinfo,verify=False,timeout=5) #download above page, send it to res.
    # time.sleep(random.uniform(7, 13))
    # res.raise_for_status()
#
    # soup1_house_title = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > a[title]')
    # for i in range(len(soup1_house_title)):
        # a = soup1_house_title[i]['title']
        # b = soup1_house_title[i]['href']
        # soup1_house_title_list.append(a)
        # soup1_house_title_link_list.append(b)
    # print(soup1_house_title_list)
    # print(soup1_house_title_link_list)
#
    # soup1_house_detail_room = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > div > div.positionInfo > a')
    # for i in range (0,len(soup1_house_detail_room),1):
        # a = soup1_house_detail_room[i].text
        # soup1_house_detail_room_list.append(a)
    # print(soup1_house_detail_room_list)
#
    # soup1_house_detail_room1 = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > div.houseInfo')
    # for i in range (0,len(soup1_house_detail_room1),1):
        # a = soup1_house_detail_room1[i].text
        # a = a.replace(" ","").replace("\n","")
        # soup1_house_detail_room1_list.append(a)
    # print(soup1_house_detail_room1_list)
#
    # soup1_house_detail_room2 = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > div.followInfo')
    # for i in range (0,len(soup1_house_detail_room2),1):
        # a = soup1_house_detail_room2[i].text
        # a = a.replace(" ","").replace("\n","")
        # soup1_house_detail_room2_list.append(a)
    # print(soup1_house_detail_room2_list)
#
    # soup1_unit_price = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > div > div.unitPrice > span')
    # for i in range(len(soup1_unit_price)):
        # a = soup1_unit_price[i].text
        # a = a.replace('单价','').replace("元/平米","")
        # soup1_unit_price_list.append(a)
    # print(soup1_unit_price_list)
#
    # soup1_total_price = bs4.BeautifulSoup(res.content,'lxml').select('li.clear > div > div > div > div.totalPrice > span')
    # for i in range(len(soup1_total_price)):
        # a = soup1_total_price[i].text
        # soup1_total_price_list.append(a)
    # print(soup1_total_price_list)
#
# soup1_consolidate = []
# for i in range(len(soup1_house_title_list)):
    # soup1_temp = []
    # soup1_temp.append(soup1_house_title_list[i])
    # soup1_temp.append('=hyperlink("' + soup1_house_title_link_list[i] + '")')
    # soup1_temp.append(soup1_house_detail_room_list[i])
    # soup1_temp.append(soup1_house_detail_room1_list[i])
    # soup1_temp.append(soup1_house_detail_room2_list[i])
    # soup1_temp.append(soup1_unit_price_list[i])
    # soup1_temp.append(soup1_total_price_list[i])
    # soup1_consolidate.append(soup1_temp)
# print(soup1_consolidate)
#
# soup1_consolidate_DataFrame = DataFrame(soup1_consolidate,columns=['house title','house link','house detail1','house detail2','house detail3','unit price','total price w RMB'])
# print(soup1_consolidate_DataFrame)
# soup1_consolidate_DataFrame.to_csv('result\ke-{}_{}.csv'.format(city,estate_area),mode='a',header=True, index=False, encoding='utf_8_sig')
# enditem = input("")
