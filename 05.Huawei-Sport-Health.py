import json
import datetime

try:
    with open('HUAWEI_HEALTH_20240916201455\Motion path detail data & description\motion path detail data.json', 'r', encoding='utf-8') as file:
        data = json.load(file)
        print('Motion path detail data.json has been loaded successfully!\n')
except FileNotFoundError:
    print("The file was not found.")
except json.JSONDecodeError:
    print("There was an error decoding the JSON.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")

data_swim = [] # to get the data for Swimming
for i in range(len(data)) :
    if data[i]['sportType'] == 102: # swimming
        data_swim.append(data[i])

swimming_info = [['recordId','StartTime','Duration-mins','Carolies-kJ','Distance-m']]
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

    swimming_temp.append(data_swim[i]['recordId'])
    swimming_temp.append(time_info_formated)
    swimming_temp.append(round(data_swim[i]['totalTime']/1000/60,1)) # mins
    swimming_temp.append(data_swim[i]['totalCalories'/1000])
    swimming_temp.append(data_swim[i]['totalDistance'])
    swimming_info.append(swimming_temp)




pass