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

swimming_info = [['StartTime','Duration','Carolies','Distance']]
for i in range(len(data_swim)):
    swimming_temp = []
    swimming_temp.append(data_swim[i]['startTime'])
    swimming_temp.append(data_swim[i]['totalTime'])
    swimming_temp.append(data_swim[i]['totalCalories'])
    swimming_temp.append(data_swim[i]['totalDistance'])
    swimming_info.append(swimming_temp)


# The timestamp in milliseconds
timestamp_ms = 1723347875000

# Convert the timestamp to seconds
timestamp_s = timestamp_ms / 1000

# Create a datetime object from the timestamp
dt_object = datetime.datetime.fromtimestamp(timestamp_s)

# Print the datetime object
print("Datetime object:", dt_object)

# Format the datetime object as a string
formatted_time = dt_object.strftime('%Y-%m-%d %H:%M:%S')
print("Formatted time:", formatted_time)

pass