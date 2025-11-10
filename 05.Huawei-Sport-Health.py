import json
import datetime
from pandas import DataFrame

try:
    with open(r'HUAWEI_HEALTH_20240916201455\Motion path detail data & description\motion path detail data.json', 'r', encoding='utf-8') as file:
        data = json.load(file)
        print('Motion path detail data.json has been loaded successfully!\n')
except FileNotFoundError:
    print("The file was not found.")
except json.JSONDecodeError:
    print("There was an error decoding the JSON.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")

data_swim = [] # to get the data for Swimming info
for i in range(len(data)) :
    if data[i]['sportType'] == 102: # swimming
        data_swim.append(data[i])

swimming_info = [['recordId','StartTime','Duration-mins','Carolies-kJ','Distance-m',\
                   'heartBeat-Mean', 'heartBeat-Max', 'LaneDistance', '# Lane', 'Pull times', \
                   'Mean Pull times', 'Mean SWOLF', 'Max Speed s', 'Mean Speed s']]
for i in range(len(data_swim)):
    swimming_temp = []

    # The timestamp in milliseconds
    time_info = data_swim[i]['startTime']

    # Convert the timestamp to seconds
    time_info = time_info / 1000

    # Create a datetime object from the timestamp
    time_info_object = datetime.datetime.fromtimestamp(time_info)

    # Print the datetime object
    print("Datetime object:", time_info_object)

    # Format the datetime object as a string
    time_info_formated = time_info_object.strftime('%Y-%m-%d %H:%M:%S')
    print("Formatted time:", time_info_formated)

    if len(data_swim[i]) == 29:
        # to get the heartRate info:
        heart_beat_df = DataFrame(data_swim[i]['heartRateList'])
        heart_beat_avg = round(heart_beat_df['heartRate'].mean(),1)
        heart_beat_max = heart_beat_df['heartRate'].max()

        data_swim_d = data_swim[i]['attribute'].split('&&')
        for ii in range(len(data_swim_d)):
            data_swim_d[ii] = data_swim_d[ii].split('@is')
        data_swim_track_detail = data_swim_d[0][1]
        data_swim_track_detail = data_swim_track_detail.split('\n')
        data_swim_track_detail = data_swim_track_detail[:len(data_swim_track_detail)-1]

        data_swim_track_simplify = data_swim_d[1][1]
        data_swim_track_simplify = json.loads(data_swim_track_simplify)
        swim_mSwimSegments = data_swim_track_simplify['mSwimSegments']
        swim_mSwimSegments_df = DataFrame(swim_mSwimSegments)
        swim_mlaneDistance = swim_mSwimSegments_df['mDistance'][0] # 泳池长度
        swim_mN_lane = swim_mSwimSegments_df['mSegmentIndex'].max() # 趟数
        swim_mPullTimes = swim_mSwimSegments_df['mPullTimes'].sum() # 划水次数
        swim_mPullTimes_mean = int(swim_mPullTimes / (swim_mSwimSegments_df['mDuration'].sum() / 60 )) # 平均划水次数
        swim_mSwolf = int(swim_mSwimSegments_df['mSwolf'].mean()) # 平均 SWOLF
        swim_mDuration_min = swim_mSwimSegments_df['mDuration'].min() # 最快速度s
        swim_mDuration_mean = int(swim_mSwimSegments_df['mDuration'].mean()) # 平均速度s
    else:
        heart_beat_avg = 0
        heart_beat_max = 0
        swim_mPullTimes = 0
        swim_mSwolf = 0
        swim_mlaneDistance = 0
        swim_mN_lane = 0
        swim_mDuration_min = 0
        swim_mDuration_mean = 0
        swim_mPullTimes_mean = 0


    swimming_temp.append(data_swim[i]['recordId'])
    swimming_temp.append(time_info_formated)
    swimming_temp.append(round(data_swim[i]['totalTime']/1000/60,1)) # mins
    swimming_temp.append(data_swim[i]['totalCalories']/1000)
    swimming_temp.append(data_swim[i]['totalDistance'])
    swimming_temp.append(heart_beat_avg)
    swimming_temp.append(heart_beat_max)
    swimming_temp.append(swim_mlaneDistance)
    swimming_temp.append(swim_mN_lane)
    swimming_temp.append(swim_mPullTimes)
    swimming_temp.append(swim_mPullTimes_mean)
    swimming_temp.append(swim_mSwolf)
    swimming_temp.append(swim_mDuration_min)
    swimming_temp.append(swim_mDuration_mean)

    swimming_info.append(swimming_temp)
swimming_info = DataFrame(swimming_info[1:],columns=swimming_info[0])

print('\n')
print('================================')
print('\n')
print('云天河，以下是您在2024年度的游泳总结：\n')

distance_times_df = swimming_info[(swimming_info['Distance-m'] != 0)]
distance_times_df = distance_times_df[(distance_times_df['Distance-m'] > 999)]
print('您今年游泳的总次数为：' + str(int(swimming_info['recordId'].count())) + ' 次.\n')
print('其中，单次游泳 超过1000米的次数为：' +  str(int(distance_times_df['recordId'].count())) + ' 次.\n')
print('您今年游泳的总时长为：' + str(round(swimming_info['Duration-mins'].sum() / 60,1)) + ' 小时.\n')
print('您今年游泳的总距离为：' + str(round(swimming_info['Distance-m'].sum() / 1000)) + ' km.\n')
print('您今年游泳消耗的总热量为：' + str(int(swimming_info['Carolies-kJ'].sum())) + ' kJ.\n')
print('您今年游泳的总平均心率为：' + str(int(swimming_info['heartBeat-Mean'].mean())) + ' 次每分钟.\n')

heart_beat_max_df = swimming_info[(swimming_info['heartBeat-Max'] != 0)]
heart_beat_max_df = heart_beat_max_df[(heart_beat_max_df['heartBeat-Max'] > 100) & \
                                      (heart_beat_max_df['heartBeat-Max'] != heart_beat_max_df['heartBeat-Max'].max())]
print('您今年游泳的平均最大心率为：' + str(int(heart_beat_max_df['heartBeat-Max'].mean())) + ' 次每分钟.\n')

speed_max_df = swimming_info[(swimming_info['Max Speed s'] != 0)]
speed_max_df = speed_max_df[(speed_max_df['Max Speed s'] != speed_max_df['Max Speed s'].min()) & \
                                      (speed_max_df['Max Speed s'] != speed_max_df['Max Speed s'].max())]
print('您今年游泳的单趟50米 平均最快速度 为：' + str(int(speed_max_df['Max Speed s'].mean())) + ' 秒每趟.\n')

speed_overall_mean_df = swimming_info[(swimming_info['Mean Speed s'] != 0)]
speed_overall_mean_df = speed_overall_mean_df[(speed_overall_mean_df['Mean Speed s'] != speed_overall_mean_df['Mean Speed s'].min()) & (speed_overall_mean_df['Mean Speed s'] != speed_overall_mean_df['Mean Speed s'].max())]
print('您今年游泳的单趟50米 总体平均速度 为：' + str(int(speed_overall_mean_df['Mean Speed s'].mean())) + ' 秒每趟.\n')

print('================================')

pass