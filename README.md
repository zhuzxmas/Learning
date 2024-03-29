### Use Github Actions to Automaticly Export Microsoft Teams Shifts Clockin Clockout data to Excel
This is for my own learning record:

# to use config file in Python
```
import configparser
config = configparser.ConfigParser()
config.read(['config.cfg'])
azure_settings = config['azure']
client_id = azure_settings['client_id']
```

# to check if file exists:
```
if os.path.exists('./config.cfg')
```

# to use Github Secrets:
- setup Github Secrets first in Github repository
- extract secrets in github workflow .yml file as below:
```
env:
   client_id : ${{secrets.CLIENT_ID}}
run: python -u main.py
```
Here, `client_id` is the variable that coudl be used in python code. `CLIENT_ID` is the secret variable saved in Github.

