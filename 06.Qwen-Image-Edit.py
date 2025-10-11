import json
import os
from dashscope import MultiModalConversation
import dashscope

# 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
api_key = os.environ['ali_cloud_secret']
image_edit_input_json = os.environ['image_edit_input_json']

dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

messages = [
    {
        "role": "user",
        "content": [
            {"image": image_edit_input_json['image_url']},
            {"text": image_edit_input_json['text']}
        ]
    }
]

response = MultiModalConversation.call(
    api_key=api_key,
    model="qwen-image-edit",
    messages=messages,
    result_format='message',
    stream=False,
    watermark=False,
    negative_prompt=""
)


if response.status_code == 200:
    # 如需查看完整响应，请取消下行注释
    print("输出图像的URL:", response.output.choices[0].message.content[0]['image'])
    print(json.dumps(response, ensure_ascii=False))
else:
    print(f"HTTP返回码：{response.status_code}")
    print(f"错误码：{response.code}")
    print(f"错误信息：{response.message}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")